import { apiJson } from "@/lib/api/client-response";
import type { MailboxOption } from "./mailbox-provider";

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

/**
 * Fetches the signed-in user's mailbox options. Caching and request dedupe
 * moved to TanStack Query under `mailboxKeys.user` (T-34); the F50
 * account-switch isolation contract is met by the root QueryClient clearing
 * itself via the account-state reset coordinator, so no module-level cache or
 * generation counter remains here.
 */
export async function fetchMailboxOptions(): Promise<MailboxOption[]> {
	const data = await apiJson.get<{ mailboxes?: MailboxOption[] }>("/api/mailboxes");
	return (data.mailboxes ?? []).map((m) => ({
		id: m.id,
		localPart: m.localPart,
		hostname: m.hostname,
		displayName: m.displayName,
		role: m.role,
		isPrimary: m.isPrimary,
	}));
}
