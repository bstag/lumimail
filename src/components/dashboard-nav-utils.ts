import type { CountedFolder, MessageCounts } from "@/hooks/types";

export function getFolderNavCount(folder: CountedFolder, counts: MessageCounts["folders"]): number | undefined {
	const count = counts[folder];
	if (folder === "inbox" || folder === "spam") return count.unread;
	return undefined;
}
