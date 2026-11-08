import type { CountedFolder, MessageCounts } from "@/hooks/types";
import type { messages } from "@/db/schema";

export type MessageCountRow = Pick<
	typeof messages.$inferSelect,
	"mailboxId" | "direction" | "status" | "read"
> & {
	/** Received mail whose snooze has not yet ended; it is not in the Inbox (F100). */
	sleeping?: boolean;
};

export type FolderAccumulator = MessageCounts["folders"];

export type CountableFolder = CountedFolder | null;
