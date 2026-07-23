import { authFetch } from "@/lib/auth/client";
import { registerAccountStateReset } from "@/lib/auth/account-state";
import type { MailboxOption } from "./mailbox-provider";

let mailboxesCache: MailboxOption[] | null = null;
let mailboxesRequest: Promise<MailboxOption[]> | null = null;
let mailboxesGeneration = 0;

export function clearMailboxesCache() {
	mailboxesGeneration += 1;
	mailboxesCache = null;
	mailboxesRequest = null;
}

registerAccountStateReset(clearMailboxesCache);

export function canMailboxSend(
	mailbox: Pick<MailboxOption, "role"> | null | undefined,
): boolean {
	return mailbox?.role === "responder" || mailbox?.role === "manager";
}

export function findSendCapableMailbox(
	mailboxes: readonly MailboxOption[],
): MailboxOption | undefined {
	return mailboxes.find(canMailboxSend);
}

export async function fetchMailboxOptions(force = false): Promise<MailboxOption[]> {
	if (force) clearMailboxesCache();
	if (!force && mailboxesCache) return mailboxesCache;
	if (!force && mailboxesRequest) return mailboxesRequest;

	const requestGeneration = mailboxesGeneration;
	const request = authFetch("/api/mailboxes")
		.then((res) => res.json())
		.then((data) => {
			const items = ((data as { mailboxes?: MailboxOption[] }).mailboxes ?? []).map((m) => ({
				id: m.id,
				localPart: m.localPart,
				hostname: m.hostname,
				displayName: m.displayName,
				role: m.role,
				isPrimary: m.isPrimary,
			}));
			if (mailboxesGeneration === requestGeneration) mailboxesCache = items;
			return items;
		})
		.finally(() => {
			if (mailboxesRequest === request) mailboxesRequest = null;
		});

	mailboxesRequest = request;
	return request;
}
