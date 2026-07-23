import { authFetch } from "@/lib/auth/client";
import type { MailboxOption } from "./mailbox-provider";

let mailboxesCache: MailboxOption[] | null = null;
let mailboxesRequest: Promise<MailboxOption[]> | null = null;

export function clearMailboxesCache() {
	mailboxesCache = null;
	mailboxesRequest = null;
}

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
	if (!force && mailboxesCache) return mailboxesCache;
	if (!force && mailboxesRequest) return mailboxesRequest;

	mailboxesRequest = authFetch("/api/mailboxes")
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
			mailboxesCache = items;
			return items;
		})
		.finally(() => {
			mailboxesRequest = null;
		});

	return mailboxesRequest;
}
