import { getContactDisplayNameMap } from "@/lib/contacts/service";
import { normalizeEmailAddress } from "@/lib/email/address";
import { getLatestEmailContent } from "@/lib/email/reply-content-utils";

type EnrichableMessage = {
	fromAddr: string;
	toAddr: string;
	snippet: string | null;
};

export type EnrichedMessage<T extends EnrichableMessage> = Omit<T, "snippet"> & {
	snippet: string;
	fromContactName: string | null;
	toContactName: string | null;
};

/**
 * Presentation enrichment for message listings: resolves the caller's contact
 * display names for each row's from/to addresses in one batched lookup, and
 * reduces the stored snippet to its latest (non-quoted) content.
 */
export async function enrichMessagesWithContacts<T extends EnrichableMessage>(
	env: CloudflareEnv,
	userId: string,
	rows: T[],
): Promise<EnrichedMessage<T>[]> {
	const contactMap = await getContactDisplayNameMap(
		env,
		userId,
		rows.flatMap((message) => [message.fromAddr, message.toAddr]),
	);
	return rows.map((message) => ({
		...message,
		snippet: getLatestEmailContent(message.snippet),
		fromContactName: contactMap.get(normalizeEmailAddress(message.fromAddr)) ?? null,
		toContactName: contactMap.get(normalizeEmailAddress(message.toAddr)) ?? null,
	}));
}
