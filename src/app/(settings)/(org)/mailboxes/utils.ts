import { getMailboxAddress } from "@/lib/email/address";
import type { Mailbox } from "./types";

export { getMailboxAddress };

export function getMailboxName(mailbox: Pick<Mailbox, "displayName" | "localPart">): string {
	return mailbox.displayName?.trim() || mailbox.localPart;
}
