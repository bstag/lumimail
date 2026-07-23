import type { MailboxOption } from "@/components/mailbox-provider";
import { authFetch } from "@/lib/auth/client";
import { getMailboxAddress } from "@/lib/email/address";
import type { CurrentMailboxFormResponse } from "./types";

export { getMailboxAddress };

export async function updateCurrentMailboxName(id: string, displayName: string): Promise<MailboxOption> {
	const res = await authFetch(`/api/mailboxes/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ displayName }),
	});
	const data = (await res.json()) as CurrentMailboxFormResponse;

	if (!res.ok || !data.mailbox) {
		throw new Error(typeof data.error === "string" ? data.error : "Failed to update mailbox");
	}

	return {
		id: data.mailbox.id,
		localPart: data.mailbox.localPart,
		hostname: data.mailbox.hostname,
		displayName: data.mailbox.displayName,
		role: data.mailbox.role,
		isPrimary: data.mailbox.isPrimary,
	};
}
