import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/db";
import { applyFilterToExisting, applyMessageFilters } from "@/lib/email/message-filters";
import { expireMessages } from "@/lib/email/message-expiry";
import { filterAlternatives, filterParameterCount, type MessageFilterRow } from "@/lib/email/filter-condition";
import { createMigratedDb, seedMessage } from "../../helpers/sqlite";

let sqlite: DatabaseSync;
let db: AppDatabase;
let filterCount = 0;

beforeEach(() => {
	({ sqlite, db } = createMigratedDb());
	filterCount = 0;
});

afterEach(() => sqlite.close());

function addFilter(fields: Record<string, string | number | null>) {
	const row: Record<string, string | number | null> = { id: `f${++filterCount}`, user_id: "u1", name: "F", created_at: filterCount, ...fields };
	const columns = Object.keys(row);
	sqlite.prepare(`INSERT INTO message_filters (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
		.run(...Object.values(row));
	return row.id as string;
}

function filterRow(id: string): MessageFilterRow {
	const raw = sqlite.prepare("SELECT * FROM message_filters WHERE id = ?").get(id) as Record<string, unknown>;
	return {
		id: raw.id, userId: raw.user_id, name: raw.name, fromContains: raw.from_contains, toContains: raw.to_contains,
		subjectContains: raw.subject_contains, hasWords: raw.has_words, actionStar: Boolean(raw.action_star),
		actionMarkRead: Boolean(raw.action_mark_read), actionArchive: Boolean(raw.action_archive),
		actionLabelId: raw.action_label_id, actionMoveToTrash: Boolean(raw.action_move_to_trash),
		matchMode: raw.match_mode, actionFocus: raw.action_focus, actionExpireDays: raw.action_expire_days,
		enabled: Boolean(raw.enabled), createdAt: new Date(Number(raw.created_at) * 1000),
	} as MessageFilterRow;
}

function message(id: string) {
	return sqlite.prepare("SELECT status, read, starred, focus_override, expires_at FROM messages WHERE id = ?").get(id) as {
		status: string; read: number; starred: number; focus_override: string | null; expires_at: number | null;
	};
}

function labelsOf(id: string) {
	return (sqlite.prepare("SELECT label_id FROM message_labels WHERE message_id = ? ORDER BY label_id").all(id) as Array<{ label_id: string }>)
		.map((row) => row.label_id);
}

describe("filter matching (F101)", () => {
	it("splits comma alternatives and counts bound parameters", () => {
		expect(filterAlternatives(" Amazon.com, ,EBAY.com ")).toEqual(["amazon.com", "ebay.com"]);
		expect(filterAlternatives(null)).toEqual([]);
		expect(filterParameterCount({ fromContains: "a,b", toContains: null, subjectContains: "c", hasWords: "d", matchMode: "all" })).toBe(7);
	});

	it("matches any alternative, case-insensitively, with % and _ taken literally", async () => {
		seedMessage(sqlite, { id: "m1", from_addr: "Shop <Deals@EBAY.com>" });
		seedMessage(sqlite, { id: "m2", from_addr: "news@paper.test", subject: "100% off_today" });
		seedMessage(sqlite, { id: "m3", from_addr: "friend@x.test", subject: "100 percent" });
		addFilter({ from_contains: "amazon.com, ebay.com", action_star: 1 });
		addFilter({ subject_contains: "100% off_", action_mark_read: 1 });

		for (const id of ["m1", "m2", "m3"]) await applyMessageFilters(db, "u1", id);

		expect(message("m1")).toMatchObject({ starred: 1, read: 0 });
		expect(message("m2")).toMatchObject({ starred: 0, read: 1 });
		expect(message("m3")).toMatchObject({ starred: 0, read: 0 });
	});

	it("requires every condition by default and one condition in any mode", async () => {
		seedMessage(sqlite, { id: "m1", from_addr: "shop@x.test", subject: "Weekly deals" });
		addFilter({ from_contains: "shop", subject_contains: "invoice", action_star: 1 });
		addFilter({ from_contains: "shop", subject_contains: "invoice", match_mode: "any", action_mark_read: 1 });

		await applyMessageFilters(db, "u1", "m1");

		expect(message("m1")).toMatchObject({ starred: 0, read: 1 });
	});

	it("searches the snippet and plain-text body for words", async () => {
		seedMessage(sqlite, { id: "m1", subject: "Hello", snippet: "your order shipped" });
		seedMessage(sqlite, { id: "m2", subject: "Hello" });
		seedMessage(sqlite, { id: "m3", subject: "Hello" });
		sqlite.prepare("INSERT INTO message_bodies (id, message_id, text_body) VALUES ('b2', 'm2', 'Tracking number: 1Z999')").run();
		addFilter({ has_words: "shipped, TRACKING NUMBER", action_label_id: "lbl_ship" });

		for (const id of ["m1", "m2", "m3"]) await applyMessageFilters(db, "u1", id);

		expect(labelsOf("m1")).toEqual(["lbl_ship"]);
		expect(labelsOf("m2")).toEqual(["lbl_ship"]);
		expect(labelsOf("m3")).toEqual([]);
	});

	it("never matches with a condition-less or disabled filter, or another user's filter", async () => {
		seedMessage(sqlite, { id: "m1" });
		addFilter({ action_star: 1 });
		addFilter({ from_contains: "a@x.test", enabled: 0, action_star: 1 });
		addFilter({ user_id: "u2", from_contains: "a@x.test", action_star: 1 });

		await applyMessageFilters(db, "u1", "m1");

		expect(message("m1").starred).toBe(0);
	});

	it("merges actions, sets the focus override and expiry, and labels idempotently", async () => {
		seedMessage(sqlite, { id: "m1", from_addr: "deals@shop.test" });
		addFilter({ from_contains: "shop", action_archive: 1, action_label_id: "lbl_a" });
		addFilter({ from_contains: "deals", action_move_to_trash: 1, action_focus: "other", action_expire_days: 7 });
		addFilter({ from_contains: "deals", action_label_id: "lbl_a" });

		await applyMessageFilters(db, "u1", "m1", new Date(10_000_000));

		expect(message("m1")).toMatchObject({ status: "trash", focus_override: "other", expires_at: 10_000 + 7 * 86_400 });
		expect(labelsOf("m1")).toEqual(["lbl_a"]);
	});

	it("evaluates many filters in parameter-bounded chunks", async () => {
		seedMessage(sqlite, { id: "m1", subject: "zz" });
		const words = Array.from({ length: 10 }, (_, index) => `w${index}`).join(",");
		for (let index = 0; index < 4; index++) addFilter({ has_words: words, action_mark_read: 1 });
		addFilter({ subject_contains: "zz", action_star: 1 });

		await applyMessageFilters(db, "u1", "m1");

		expect(message("m1")).toMatchObject({ starred: 1, read: 0 });
	});

	it("does nothing for a message that does not exist", async () => {
		addFilter({ from_contains: "a", action_star: 1 });
		await expect(applyMessageFilters(db, "u1", "missing")).resolves.toBeUndefined();
	});
});

describe("applyFilterToExisting (F101)", () => {
	const viewer = { id: "u1", organizationId: null };

	beforeEach(() => {
		seedMessage(sqlite, { id: "inbox", from_addr: "deals@shop.test", created_at: 1_000 });
		seedMessage(sqlite, { id: "archived", from_addr: "deals@shop.test", status: "archived", created_at: 2_000 });
		seedMessage(sqlite, { id: "trashed", from_addr: "deals@shop.test", status: "trash" });
		seedMessage(sqlite, { id: "sent", from_addr: "deals@shop.test", direction: "outbound", status: "sent" });
		seedMessage(sqlite, { id: "other-user", user_id: "u2", from_addr: "deals@shop.test" });
		seedMessage(sqlite, { id: "unrelated", from_addr: "friend@x.test" });
	});

	it("previews the count of matching Inbox and Archive mail without changing it", async () => {
		const id = addFilter({ from_contains: "shop.test", action_star: 1 });
		await expect(applyFilterToExisting(db, viewer, filterRow(id), { preview: true })).resolves.toEqual({ matched: 2 });
		expect(message("inbox").starred).toBe(0);
	});

	it("applies actions, labels and expiry from arrival to matching mail only, idempotently", async () => {
		const id = addFilter({
			from_contains: "shop.test", action_mark_read: 1, action_label_id: "lbl_deals", action_focus: "other",
			action_expire_days: 2, action_archive: 1,
		});
		await expect(applyFilterToExisting(db, viewer, filterRow(id), { preview: false })).resolves.toEqual({ matched: 2 });
		await applyFilterToExisting(db, viewer, filterRow(id), { preview: false });

		expect(message("inbox")).toMatchObject({ status: "archived", read: 1, focus_override: "other", expires_at: 1_000 + 2 * 86_400 });
		expect(message("archived").expires_at).toBe(2_000 + 2 * 86_400);
		expect(labelsOf("inbox")).toEqual(["lbl_deals"]);
		for (const untouched of ["trashed", "sent", "other-user", "unrelated"]) {
			expect(message(untouched)).toMatchObject({ read: 0, focus_override: null });
			expect(labelsOf(untouched)).toEqual([]);
		}
	});

	it("labels before trashing, and reports zero for a filter that matches nothing", async () => {
		const trash = addFilter({ from_contains: "shop.test", action_move_to_trash: 1, action_label_id: "lbl_x" });
		await applyFilterToExisting(db, viewer, filterRow(trash), { preview: false });
		expect(message("inbox").status).toBe("trash");
		expect(labelsOf("inbox")).toEqual(["lbl_x"]);

		const none = addFilter({ from_contains: "nobody" , action_star: 1 });
		await expect(applyFilterToExisting(db, viewer, filterRow(none), { preview: false })).resolves.toEqual({ matched: 0 });
		const empty = addFilter({ action_star: 1 });
		await expect(applyFilterToExisting(db, viewer, filterRow(empty), { preview: false })).resolves.toEqual({ matched: 0 });
	});

	it("counts without writing when a filter only matches and has no actions", async () => {
		const id = addFilter({ from_contains: "shop.test" });
		await expect(applyFilterToExisting(db, viewer, filterRow(id), { preview: false })).resolves.toEqual({ matched: 2 });
	});
});

describe("expireMessages (F101)", () => {
	it("trashes Inbox and Archive mail past its expiry and clears the expiry", async () => {
		seedMessage(sqlite, { id: "due", expires_at: 500 });
		seedMessage(sqlite, { id: "due-archived", status: "archived", expires_at: 1_000 });
		seedMessage(sqlite, { id: "later", expires_at: 5_000 });
		seedMessage(sqlite, { id: "spam", status: "spam", expires_at: 500 });
		seedMessage(sqlite, { id: "never" });

		await expireMessages(db, new Date(1_000_000));

		expect(message("due")).toMatchObject({ status: "trash", expires_at: null });
		expect(message("due-archived")).toMatchObject({ status: "trash", expires_at: null });
		expect(message("later")).toMatchObject({ status: "received", expires_at: 5_000 });
		expect(message("spam")).toMatchObject({ status: "spam", expires_at: 500 });
		expect(message("never").status).toBe("received");
	});

	it("defaults to the current time", async () => {
		seedMessage(sqlite, { id: "due", expires_at: 1 });
		await expireMessages(db);
		expect(message("due").status).toBe("trash");
	});
});
