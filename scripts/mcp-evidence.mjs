import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: node scripts/mcp-evidence.mjs <https-origin> <read|actions>   (set LUMIMAIL_SESSION_TOKEN; actions also sets LUMIMAIL_MCP_FROM and LUMIMAIL_MCP_TO)";
const FAILURE = "MCP OAuth evidence could not be recorded.";
const READ_TOOLS = ["get_attachment", "get_message", "get_thread", "list_conversations", "list_mailboxes"];
const ACTION_TOOLS = [...READ_TOOLS, "change_message_state", "create_draft", "delete_draft", "forward_mail", "list_drafts", "reply_mail", "send_mail", "update_draft"].toSorted();

function fail() {
	throw new Error(FAILURE);
}

function exactOrigin(value) {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.origin !== value || url.pathname !== "/" || url.username || url.password || url.search || url.hash) fail();
		return url.origin;
	} catch {
		fail();
	}
}

function safeSecret(value) {
	if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /\s/.test(value)) fail();
	return value;
}

function base64url(value) {
	return value.toString("base64url");
}

function pkce() {
	const verifier = base64url(randomBytes(48));
	return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

async function json(response, status) {
	if (response.status !== status) fail();
	try {
		return await response.json();
	} catch {
		fail();
	}
}

async function expectStatus(fetchImpl, url, init, status) {
	const response = await fetchImpl(url, { redirect: "manual", ...init });
	if (response.status !== status) fail();
	return response;
}

function authorizationQuery({ clientId, redirectUri, scope, resource, state, challenge, method = "S256" }) {
	const query = new URLSearchParams({
		response_type: "code", client_id: clientId, redirect_uri: redirectUri,
		scope, resource, state,
	});
	if (challenge) {
		query.set("code_challenge", challenge);
		query.set("code_challenge_method", method);
	}
	return `?${query}`;
}

async function inspectAuthorization(fetchImpl, origin, sessionToken, query) {
	return fetchImpl(`${origin}/api/mcp/authorization?authorizationQuery=${encodeURIComponent(query)}`, {
		headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
		redirect: "manual",
	});
}

async function tokenRequest(fetchImpl, endpoint, fields) {
	const response = await fetchImpl(endpoint, {
		method: "POST", redirect: "manual",
		headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields),
	});
	const body = await response.json().catch(() => ({}));
	return { response, body };
}

function parseMcpBody(text) {
	try {
		if (text.trimStart().startsWith("{")) return JSON.parse(text);
		const data = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
		if (!data) fail();
		return JSON.parse(data.slice(5).trim());
	} catch {
		fail();
	}
}

function structuredToolResult(response) {
	if (response?.error || response?.result?.isError) fail();
	const value = response?.result?.structuredContent;
	if (!value || typeof value !== "object") fail();
	return value;
}

function createMcpCaller(fetchImpl, resource, accessToken) {
	let id = 0;
	let sessionId;
	return async function call(method, params, notification = false) {
		const response = await fetchImpl(resource, {
			method: "POST", redirect: "manual",
			headers: {
				accept: "application/json, text/event-stream",
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
				...(sessionId ? { "mcp-session-id": sessionId } : {}),
			},
			body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: ++id }), method, ...(params ? { params } : {}) }),
		});
		if (notification) {
			if (![200, 202, 204].includes(response.status)) fail();
			return null;
		}
		if (response.status !== 200) fail();
		sessionId = response.headers.get("mcp-session-id") || sessionId;
		return parseMcpBody(await response.text());
	};
}

async function initializeAndList(fetchImpl, resource, accessToken) {
	const call = createMcpCaller(fetchImpl, resource, accessToken);
	const initialized = await call("initialize", {
		protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Lumimail evidence", version: "1" },
	});
	if (initialized?.error || initialized?.result?.serverInfo?.name !== "Lumimail") fail();
	await call("notifications/initialized", undefined, true);
	const listed = await call("tools/list", {});
	const names = listed?.result?.tools?.map((tool) => tool.name).toSorted();
	if (!Array.isArray(names)) fail();
	return { call, names };
}

async function proveActionSend(call, from, to) {
	const mailboxResult = structuredToolResult(await call("tools/call", { name: "list_mailboxes", arguments: {} }));
	const mailbox = mailboxResult.mailboxes?.find((entry) => entry.address?.toLowerCase() === from.toLowerCase());
	if (!mailbox) fail();
	const key = `proof_${randomUUID().replaceAll("-", "")}`;
	const input = { from, to, mailboxId: mailbox.id, subject: "Lumimail MCP delivery proof", text: "Automated Lumimail MCP evidence.", idempotencyKey: key };
	const first = structuredToolResult(await call("tools/call", { name: "send_mail", arguments: input }));
	const second = structuredToolResult(await call("tools/call", { name: "send_mail", arguments: input }));
	if (!first.messageId || second.messageId !== first.messageId || second.replayed !== true) fail();
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const detail = structuredToolResult(await call("tools/call", { name: "get_message", arguments: { messageId: first.messageId } }));
		if (["sent", "failed"].includes(detail.message?.status)) return;
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	fail();
}

export async function proveMcpIntegration({ origin, profile, sessionToken, from, to, fetchImpl = fetch }) {
	const base = exactOrigin(origin);
	const session = safeSecret(sessionToken);
	if (profile !== "read" && profile !== "actions") fail();
	if (profile === "actions") {
		if (typeof from !== "string" || !from.includes("@") || typeof to !== "string" || !to.includes("@")) fail();
	}
	const resource = `${base}/mcp`;
	const protectedMetadata = await json(await expectStatus(fetchImpl, `${base}/.well-known/oauth-protected-resource/mcp`, {}, 200), 200);
	const serverMetadata = await json(await expectStatus(fetchImpl, `${base}/.well-known/oauth-authorization-server`, {}, 200), 200);
	if (protectedMetadata.resource !== resource || serverMetadata.issuer !== base || serverMetadata.code_challenge_methods_supported?.includes("S256") !== true) fail();
	const challengeResponse = await expectStatus(fetchImpl, resource, {
		method: "POST", headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "probe", version: "1" } } }),
	}, 401);
	if (!challengeResponse.headers.get("www-authenticate")?.includes("oauth-protected-resource/mcp")) fail();

	const redirectUri = "http://127.0.0.1/callback";
	const registration = await json(await fetchImpl(serverMetadata.registration_endpoint, {
		method: "POST", redirect: "manual", headers: { accept: "application/json", "content-type": "application/json" },
		body: JSON.stringify({ client_name: "Lumimail managed evidence", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
	}), 201);
	if (typeof registration.client_id !== "string") fail();

	const verifier = pkce();
	const requestedScope = profile === "actions" ? "mail.read mail.actions" : "mail.read";
	const common = { clientId: registration.client_id, redirectUri, scope: requestedScope, resource, state: randomUUID() };
	if ((await inspectAuthorization(fetchImpl, base, session, authorizationQuery(common))).status !== 400) fail();
	if ((await inspectAuthorization(fetchImpl, base, session, authorizationQuery({ ...common, challenge: verifier.verifier, method: "plain" }))).status !== 400) fail();
	if ((await inspectAuthorization(fetchImpl, base, session, authorizationQuery({ ...common, redirectUri: "http://127.0.0.1/wrong", challenge: verifier.challenge }))).status !== 400) fail();

	const query = authorizationQuery({ ...common, challenge: verifier.challenge });
	let inspection;
	for (let attempt = 0; attempt < 10; attempt += 1) {
		inspection = await inspectAuthorization(fetchImpl, base, session, query);
		if (inspection.status === 200) break;
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	if (inspection?.status !== 200) fail();
	const approval = await json(await fetchImpl(`${base}/api/mcp/authorization`, {
		method: "POST", redirect: "manual",
		headers: { accept: "application/json", authorization: `Bearer ${session}`, "content-type": "application/json", origin: base },
		body: JSON.stringify({ authorizationQuery: query, decision: "approve", profile }),
	}), 201);
	const redirect = new URL(approval.data?.redirectTo);
	const code = redirect.searchParams.get("code");
	if (redirect.origin !== "http://127.0.0.1" || !code || redirect.searchParams.get("state") !== common.state) fail();

	const exchanged = await tokenRequest(fetchImpl, serverMetadata.token_endpoint, {
		grant_type: "authorization_code", code, client_id: registration.client_id,
		redirect_uri: redirectUri, code_verifier: verifier.verifier, resource,
	});
	if (exchanged.response.status !== 200 || !exchanged.body.access_token || !exchanged.body.refresh_token) fail();
	const initial = await initializeAndList(fetchImpl, resource, exchanged.body.access_token);
	const expectedTools = profile === "actions" ? ACTION_TOOLS : READ_TOOLS;
	if (JSON.stringify(initial.names) !== JSON.stringify(expectedTools.toSorted())) fail();
	if (profile === "actions") await proveActionSend(initial.call, from, to);

	const wrong = await tokenRequest(fetchImpl, serverMetadata.token_endpoint, {
		grant_type: "refresh_token", refresh_token: exchanged.body.refresh_token,
		client_id: registration.client_id, scope: "mail.read", resource: `${base}/wrong`,
	});
	if (wrong.response.status < 400) fail();
	const refreshed = await tokenRequest(fetchImpl, serverMetadata.token_endpoint, {
		grant_type: "refresh_token", refresh_token: exchanged.body.refresh_token,
		client_id: registration.client_id, scope: "mail.read", resource,
	});
	if (refreshed.response.status !== 200 || !refreshed.body.access_token || !refreshed.body.refresh_token) fail();
	const replay = await tokenRequest(fetchImpl, serverMetadata.token_endpoint, {
		grant_type: "refresh_token", refresh_token: exchanged.body.refresh_token,
		client_id: registration.client_id, scope: "mail.read", resource,
	});
	if (replay.response.status !== 200 || !replay.body.refresh_token) fail();
	const replayAgain = await tokenRequest(fetchImpl, serverMetadata.token_endpoint, {
		grant_type: "refresh_token", refresh_token: exchanged.body.refresh_token,
		client_id: registration.client_id, scope: "mail.read", resource,
	});
	if (replayAgain.response.status < 400) fail();
	const downscoped = await initializeAndList(fetchImpl, resource, refreshed.body.access_token);
	if (JSON.stringify(downscoped.names) !== JSON.stringify(READ_TOOLS.toSorted())) fail();

	const revoked = await fetchImpl(serverMetadata.revocation_endpoint, {
		method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ token: replay.body.refresh_token, token_type_hint: "refresh_token", client_id: registration.client_id }),
	});
	if (revoked.status !== 200) fail();
	await expectStatus(fetchImpl, resource, {
		method: "POST", headers: { authorization: `Bearer ${refreshed.body.access_token}`, "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
	}, 401);

	return { outcome: "passed", checks: ["discovery", "challenge", "registration", "pkce", "consent", "token", "tools", ...(profile === "actions" ? ["idempotent-send"] : []), "wrong-resource", "refresh-rotation-grace", "revocation"] };
}

export async function runMcpEvidenceCommand(args, {
	stdout = console.log, stderr = console.error, environment = process.env, prove = proveMcpIntegration,
} = {}) {
	if (!Array.isArray(args) || args.length !== 2 || !["read", "actions"].includes(args[1]) || !environment.LUMIMAIL_SESSION_TOKEN ||
		(args[1] === "actions" && (!environment.LUMIMAIL_MCP_FROM || !environment.LUMIMAIL_MCP_TO))) {
		stderr(USAGE);
		return 1;
	}
	try {
		const report = await prove({ origin: args[0], profile: args[1], sessionToken: environment.LUMIMAIL_SESSION_TOKEN, from: environment.LUMIMAIL_MCP_FROM, to: environment.LUMIMAIL_MCP_TO });
		for (const check of report.checks) stdout(`PASS  ${check}`);
		stdout(`PASS  ${report.checks.length}/${report.checks.length} MCP OAuth evidence checks`);
		return report.outcome === "passed" ? 0 : 1;
	} catch {
		stderr(FAILURE);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await runMcpEvidenceCommand(process.argv.slice(2));
}
