import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { getMailboxAddress } from "@/lib/email/address";
import type { MailboxDetail, MailboxDetailResponse, MailboxMembersData, MailboxRole } from "./types";

export { getMailboxAddress };

export async function fetchMailbox(id: string): Promise<MailboxDetail> {
	const res = await authFetch(`/api/mailboxes/${id}`);
	const json = (await res.json()) as MailboxDetailResponse;

	if (!res.ok || !json.mailbox) {
		throw new Error(json.error ?? "Failed to load mailbox");
	}

	return json.mailbox;
}

export async function updateMailboxName(id: string, displayName: string): Promise<MailboxDetail> {
	const res = await authFetch(`/api/mailboxes/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ displayName }),
	});
	const json = (await res.json()) as MailboxDetailResponse;

	if (!res.ok || !json.mailbox) {
		throw new Error(json.error ?? "Failed to update mailbox");
	}

	return json.mailbox;
}

export async function deleteMailbox(id: string, confirmAddress: string) {
	const response = await authFetch(`/api/mailboxes/${id}`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ confirmAddress }),
	});
	const json = (await response.json()) as { ok?: true; error?: string };
	if (!response.ok || !json.ok) {
		throw new Error(json.error ?? "Failed to delete mailbox");
	}
	return { ok: true as const };
}

export async function fetchMailboxMembers(mailboxId: string): Promise<MailboxMembersData> {
	const response = await authFetch(`/api/mailboxes/${mailboxId}/members`);
	return parseApiResponse<MailboxMembersData>(response);
}

export async function addMailboxMember(mailboxId: string, userId: string, role: MailboxRole) {
	const response = await authFetch(`/api/mailboxes/${mailboxId}/members`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ userId, role }),
	});
	return parseApiResponse<{ id: string }>(response);
}

export async function updateMailboxMemberRole(
	mailboxId: string,
	membershipId: string,
	role: MailboxRole,
) {
	const response = await authFetch(`/api/mailboxes/${mailboxId}/members/${membershipId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ role }),
	});
	return parseApiResponse<{ id: string; role: MailboxRole }>(response);
}

export async function removeMailboxMember(mailboxId: string, membershipId: string) {
	const response = await authFetch(`/api/mailboxes/${mailboxId}/members/${membershipId}`, {
		method: "DELETE",
	});
	return parseApiResponse<{ ok: true }>(response);
}
