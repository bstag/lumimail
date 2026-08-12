import { createHash } from "node:crypto";

const RECOVERY_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function sqlString(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function assertPlan(plan) {
	for (const field of [
		"allowedAttachmentId",
		"allowedMailboxId",
		"allowedMessageId",
		"deniedAttachmentId",
		"deniedMailboxId",
		"deniedMessageId",
		"membershipId",
		"organizationId",
		"organizationMembershipId",
		"userId",
	]) {
		if (!RECOVERY_ID_PATTERN.test(plan?.[field] ?? "")) {
			throw new Error(`Recovery verifier ${field} must be a resolved identifier`);
		}
	}
	if (plan.allowedMailboxId === plan.deniedMailboxId) {
		throw new Error("Recovery verifier mailboxes must be distinct");
	}
	if (plan.allowedMessageId === plan.deniedMessageId) {
		throw new Error("Recovery verifier messages must be distinct");
	}
	if (typeof plan.email !== "string" || !plan.email.endsWith("@invalid.example")) {
		throw new Error("Recovery verifier email must use invalid.example");
	}
}

export function renderVerifierProvisionSql(input) {
	assertPlan(input);
	if (typeof input.passwordHash !== "string" || input.passwordHash.length < 8) {
		throw new Error("Recovery verifier password hash is required");
	}
	if (!Number.isInteger(input.now) || input.now < 0) {
		throw new Error("Recovery verifier timestamp is invalid");
	}
	return [
		`INSERT INTO users (id, email, password_hash, name, organization_id, created_at) VALUES (${sqlString(input.userId)}, ${sqlString(input.email)}, ${sqlString(input.passwordHash)}, 'Recovery Verifier', ${sqlString(input.organizationId)}, ${input.now});`,
		`INSERT INTO organization_members (id, organization_id, user_id, role, created_at) VALUES (${sqlString(input.organizationMembershipId)}, ${sqlString(input.organizationId)}, ${sqlString(input.userId)}, 'member', ${input.now});`,
		`INSERT INTO mailbox_memberships (id, mailbox_id, user_id, role, created_at, updated_at) VALUES (${sqlString(input.membershipId)}, ${sqlString(input.allowedMailboxId)}, ${sqlString(input.userId)}, 'viewer', ${input.now}, ${input.now});`,
		`INSERT INTO attachments (id, message_id, filename, content_type, size, r2_key, disposition, content_id, created_at) SELECT ${sqlString(input.deniedAttachmentId)}, ${sqlString(input.deniedMessageId)}, filename, content_type, size, r2_key, disposition, content_id, ${input.now} FROM attachments WHERE id = ${sqlString(input.allowedAttachmentId)};`,
	].join("\n");
}

export function renderVerifierCleanupSql(plan) {
	assertPlan(plan);
	return [
		`DELETE FROM attachments WHERE id = ${sqlString(plan.deniedAttachmentId)};`,
		`DELETE FROM sessions WHERE user_id = ${sqlString(plan.userId)};`,
		`DELETE FROM mailbox_memberships WHERE id = ${sqlString(plan.membershipId)};`,
		`DELETE FROM organization_members WHERE id = ${sqlString(plan.organizationMembershipId)};`,
		`DELETE FROM users WHERE id = ${sqlString(plan.userId)};`,
	].join("\n");
}

async function requireJson(response, label) {
	if (!response.ok) throw new Error(`${label} returned ${response.status}`);
	try {
		return await response.json();
	} catch {
		throw new Error(`${label} did not return JSON`);
	}
}

function dataOf(value) {
	return value?.data ?? value;
}

export async function verifyRecoveryApplication({
	baseUrl,
	email,
	password,
	plan,
	expectedAttachment,
	fetchImpl = fetch,
}) {
	assertPlan({ ...plan, email });
	const origin = new URL(baseUrl);
	if (origin.protocol !== "https:" || origin.pathname !== "/") {
		throw new Error("Recovery verifier baseUrl must be an HTTPS origin");
	}
	if (
		!Number.isInteger(expectedAttachment?.size) ||
		expectedAttachment.size < 0 ||
		!SHA256_PATTERN.test(expectedAttachment?.sha256 ?? "")
	) {
		throw new Error("Recovery verifier expected attachment identity is invalid");
	}

	const login = await fetchImpl(new URL("/api/auth/login", origin), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password }),
		redirect: "manual",
	});
	if (!login.ok) throw new Error(`Recovery login returned ${login.status}`);
	const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
	if (!cookie?.startsWith("ep_session=")) {
		throw new Error("Recovery login did not issue a session cookie");
	}
	const authenticatedFetch = (path) =>
		fetchImpl(new URL(path, origin), { headers: { cookie }, redirect: "manual" });

	const me = await authenticatedFetch("/api/auth/me");
	if (!me.ok) throw new Error(`Recovery session bootstrap returned ${me.status}`);

	const mailboxJson = dataOf(await requireJson(await authenticatedFetch("/api/mailboxes"), "Recovery mailbox list"));
	const mailboxIds = mailboxJson?.mailboxes?.map((mailbox) => mailbox.id);
	if (
		!Array.isArray(mailboxIds) ||
		mailboxIds.length !== 1 ||
		mailboxIds[0] !== plan.allowedMailboxId
	) {
		throw new Error("Recovery verifier did not receive the exact allowed mailbox");
	}

	await requireJson(
		await authenticatedFetch(`/api/messages/${encodeURIComponent(plan.allowedMessageId)}`),
		"Recovery allowed message",
	);
	const attachments = dataOf(
		await requireJson(
			await authenticatedFetch(`/api/messages/${encodeURIComponent(plan.allowedMessageId)}/attachments`),
			"Recovery attachment list",
		),
	)?.attachments;
	if (!Array.isArray(attachments) || !attachments.some((entry) => entry.id === plan.allowedAttachmentId)) {
		throw new Error("Recovery allowed attachment was not listed");
	}

	const attachmentResponse = await authenticatedFetch(
		`/api/attachments/${encodeURIComponent(plan.allowedAttachmentId)}`,
	);
	if (!attachmentResponse.ok) {
		throw new Error(`Recovery allowed attachment returned ${attachmentResponse.status}`);
	}
	const attachmentBytes = new Uint8Array(await attachmentResponse.arrayBuffer());
	const attachmentSha256 = createHash("sha256").update(attachmentBytes).digest("hex");
	if (
		attachmentBytes.byteLength !== expectedAttachment.size ||
		attachmentSha256 !== expectedAttachment.sha256
	) {
		throw new Error("Recovery allowed attachment bytes do not match the manifest");
	}

	const deniedList = dataOf(
		await requireJson(
			await authenticatedFetch(`/api/messages?mailboxId=${encodeURIComponent(plan.deniedMailboxId)}`),
			"Recovery denied mailbox list",
		),
	);
	if (!Array.isArray(deniedList?.messages) || deniedList.messages.length !== 0 || deniedList.total !== 0) {
		throw new Error("Recovery denied mailbox exposed messages");
	}
	const deniedMessage = await authenticatedFetch(
		`/api/messages/${encodeURIComponent(plan.deniedMessageId)}`,
	);
	if (deniedMessage.status !== 404) {
		throw new Error(`Recovery denied message returned ${deniedMessage.status}`);
	}
	const deniedAttachment = await authenticatedFetch(
		`/api/attachments/${encodeURIComponent(plan.deniedAttachmentId)}`,
	);
	if (deniedAttachment.status !== 404) {
		throw new Error(`Recovery denied attachment returned ${deniedAttachment.status}`);
	}

	return {
		sessionAuthenticated: true,
		allowedMailboxCount: mailboxIds.length,
		allowedMessageRead: true,
		allowedAttachmentBytes: attachmentBytes.byteLength,
		allowedAttachmentSha256: attachmentSha256,
		deniedMailboxMessageCount: deniedList.messages.length,
		deniedMessageStatus: deniedMessage.status,
		deniedAttachmentStatus: deniedAttachment.status,
	};
}
