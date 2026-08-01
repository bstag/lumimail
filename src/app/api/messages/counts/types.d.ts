import type { CountedFolder, MessageCounts } from "@/hooks/types";
import type { messages } from "@/db/schema";

export type MessageCountRow = Pick<
	typeof messages.$inferSelect,
	"mailboxId" | "direction" | "status" | "read"
>;

export type FolderAccumulator = MessageCounts["folders"];

export type CountableFolder = CountedFolder | null;
