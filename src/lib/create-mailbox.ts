import type { AppDatabase } from "@/db";
import { mailboxMemberships, mailboxes } from "@/db/schema";
import { newId } from "@/lib/ids";

export async function createMailbox(db: AppDatabase, mailbox: Omit<typeof mailboxes.$inferInsert, "id">) {
	const id = newId("mbx");
	await db.batch([
		db.insert(mailboxes).values({ ...mailbox, id }),
		db.insert(mailboxMemberships).values({
			id: newId("mbm"), mailboxId: id, userId: mailbox.userId, role: "manager",
		}),
	]);
	return id;
}
