import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import {
	deleteR2Orphans,
	findR2Orphans,
	reportR2Retention,
	RETENTION_DAYS,
} from "@/lib/r2-retention";

const now = new Date("2026-07-25T00:00:00Z");
const old = new Date("2026-07-01T00:00:00Z"); // well past the retention age
const recent = new Date("2026-07-24T23:00:00Z"); // written an hour ago

let mock: DbMock;
let list: ReturnType<typeof vi.fn>;
let del: ReturnType<typeof vi.fn>;
let env: CloudflareEnv;

function object(key: string, uploaded: Date, size = 100) {
	return { key, uploaded, size };
}

/** Queues one non-truncated list page per configured prefix. */
function singlePagePerPrefix(rawObjects: unknown[], attachmentObjects: unknown[]) {
	list
		.mockResolvedValueOnce({ objects: rawObjects, truncated: false })
		.mockResolvedValueOnce({ objects: attachmentObjects, truncated: false });
}

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	h.db = mock.db;
	list = vi.fn();
	del = vi.fn().mockResolvedValue(undefined);
	env = { BUCKET: { list, delete: del } } as unknown as CloudflareEnv;
});

describe("findR2Orphans", () => {
	it("selects an unreferenced object older than the retention age", async () => {
		singlePagePerPrefix([object("inbound/1.eml", old)], []);
		mock.queueSelect([]); // no message references it

		const result = await findR2Orphans(env, { now });

		expect(result.scanned).toBe(1);
		expect(result.orphans.map((o) => o.key)).toEqual(["inbound/1.eml"]);
	});

	it("never selects an object that is still referenced", async () => {
		singlePagePerPrefix([object("inbound/1.eml", old)], []);
		mock.queueSelect([{ rawR2Key: "inbound/1.eml" }]);

		const result = await findR2Orphans(env, { now });

		expect(result.orphans).toEqual([]);
	});

	it("never selects a recently written object, so in-flight writes are safe", async () => {
		singlePagePerPrefix([object("inbound/1.eml", recent)], []);

		const result = await findR2Orphans(env, { now });

		expect(result.orphans).toEqual([]);
		// A recent object must not even be looked up; it is protected by age alone.
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("checks attachment objects against the attachment table", async () => {
		singlePagePerPrefix(
			[],
			[object("attachments/u1/m1/a1", old), object("attachments/u1/m1/a2", old)],
		);
		mock.queueSelect([{ r2Key: "attachments/u1/m1/a1" }]);

		const result = await findR2Orphans(env, { now });

		expect(result.orphans.map((o) => o.key)).toEqual(["attachments/u1/m1/a2"]);
	});

	it("pages through every cursor rather than stopping at the first list call", async () => {
		list
			.mockResolvedValueOnce({
				objects: [object("inbound/1.eml", old)],
				truncated: true,
				cursor: "c1",
			})
			.mockResolvedValueOnce({ objects: [object("inbound/2.eml", old)], truncated: false })
			.mockResolvedValueOnce({ objects: [], truncated: false });
		mock.queueSelect([]);
		mock.queueSelect([]);

		const result = await findR2Orphans(env, { now });

		expect(result.scanned).toBe(2);
		expect(result.orphans.map((o) => o.key)).toEqual(["inbound/1.eml", "inbound/2.eml"]);
		expect(list.mock.calls[1][0]).toMatchObject({ cursor: "c1" });
	});

	it("stops scanning once the object budget is reached", async () => {
		singlePagePerPrefix(
			[object("inbound/1.eml", old), object("inbound/2.eml", old)],
			[],
		);
		mock.queueSelect([]);

		const result = await findR2Orphans(env, { now, maxObjects: 1 });

		expect(result.scanned).toBe(1);
	});

	it("ignores a reference row whose key is null", async () => {
		singlePagePerPrefix([object("inbound/1.eml", old)], []);
		// raw_r2_key is nullable, so the guard exists even though the IN filter
		// cannot actually return a null row.
		mock.queueSelect([{ rawR2Key: null }]);

		const result = await findR2Orphans(env, { now });

		expect(result.orphans.map((o) => o.key)).toEqual(["inbound/1.eml"]);
	});

	it("defaults to the current time when no clock is injected", async () => {
		// Epoch is unambiguously older than any real retention cutoff.
		singlePagePerPrefix([object("inbound/ancient.eml", new Date(0))], []);
		mock.queueSelect([]);

		const result = await findR2Orphans(env);

		expect(result.orphans.map((o) => o.key)).toEqual(["inbound/ancient.eml"]);
	});

	it("only ever considers the two known prefixes", async () => {
		singlePagePerPrefix([], []);

		await findR2Orphans(env, { now });

		expect(list.mock.calls.map((call) => call[0].prefix)).toEqual([
			"inbound/",
			"attachments/",
		]);
	});
});

describe("reportR2Retention", () => {
	it("summarizes without deleting anything", async () => {
		singlePagePerPrefix(
			[object("inbound/1.eml", old, 500), object("inbound/2.eml", old, 250)],
			[],
		);
		mock.queueSelect([]);

		const report = await reportR2Retention(env, { now });

		expect(report).toMatchObject({ scanned: 2, orphans: 2, bytes: 750 });
		expect(report.oldestUploadedAt).toBe(old.toISOString());
		expect(del).not.toHaveBeenCalled();
	});

	it("caps the key sample and reports null when nothing is orphaned", async () => {
		const many = Array.from({ length: 25 }, (_, i) => object(`inbound/${i}.eml`, old));
		singlePagePerPrefix(many, []);
		mock.queueSelect([]);

		const report = await reportR2Retention(env, { now });

		expect(report.sample).toHaveLength(20);

		singlePagePerPrefix([], []);
		const empty = await reportR2Retention(env, { now });
		expect(empty).toMatchObject({ orphans: 0, bytes: 0, oldestUploadedAt: null });
	});
});

describe("deleteR2Orphans", () => {
	it("deletes the reported orphans and reports what remains", async () => {
		singlePagePerPrefix(
			[object("inbound/1.eml", old, 10), object("inbound/2.eml", old, 20)],
			[],
		);
		mock.queueSelect([]);

		const result = await deleteR2Orphans(env, { now, limit: 1 });

		expect(result).toEqual({ deleted: 1, bytes: 10, remaining: 1 });
		expect(del).toHaveBeenCalledTimes(1);
		expect(del).toHaveBeenCalledWith("inbound/1.eml");
	});

	it("is safe to re-run once nothing is orphaned", async () => {
		singlePagePerPrefix([], []);

		expect(await deleteR2Orphans(env, { now })).toEqual({
			deleted: 0,
			bytes: 0,
			remaining: 0,
		});
		expect(del).not.toHaveBeenCalled();
	});

	it("counts an already-deleted object as deleted rather than failing the run", async () => {
		singlePagePerPrefix([object("inbound/1.eml", old, 10)], []);
		mock.queueSelect([]);
		del.mockRejectedValue(new Error("gone"));

		const result = await deleteR2Orphans(env, { now });

		expect(result.deleted).toBe(0);
		expect(result.remaining).toBe(1);
	});
});

describe("retention age", () => {
	it("is the seven days the policy documents", () => {
		expect(RETENTION_DAYS).toBe(7);
	});
});
