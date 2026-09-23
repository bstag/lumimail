import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("adds indexed due scheduling without replaying historical unknown deliveries", () => {
	const db = new DatabaseSync(":memory:");
	try {
		db.exec("CREATE TABLE webhook_deliveries (id TEXT PRIMARY KEY, status TEXT, attempts INTEGER); INSERT INTO webhook_deliveries VALUES ('old', 'pending', 0), ('sent', 'delivered', 1), ('failed', 'failed', 1);");
		db.exec(readFileSync("drizzle/migrations/0040_isolate_webhook_delivery.sql", "utf8"));
		expect(db.prepare("SELECT * FROM webhook_deliveries ORDER BY id").all()).toEqual([
			{ id: "failed", status: "failed", attempts: 1, next_attempt_at: 0 },
			{ id: "old", status: "failed", attempts: 0, next_attempt_at: 0 },
			{ id: "sent", status: "delivered", attempts: 1, next_attempt_at: 0 },
		]);
		expect(db.prepare("EXPLAIN QUERY PLAN SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= 100 ORDER BY next_attempt_at LIMIT 10").all()).toEqual(expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining("webhook_deliveries_due_idx") })]));
		db.exec("UPDATE webhook_deliveries SET next_attempt_at = 1784768200000 WHERE id = 'old'; UPDATE webhook_deliveries SET next_attempt_at = 1784768200 WHERE id = 'sent';");
		const normalization = readFileSync("drizzle/migrations/0041_normalize_webhook_due_timestamp.sql", "utf8");
		db.exec(normalization);
		db.exec(normalization);
		expect(db.prepare("SELECT next_attempt_at FROM webhook_deliveries ORDER BY id").all()).toEqual([
			{ next_attempt_at: 0 }, { next_attempt_at: 1784768200 }, { next_attempt_at: 1784768200 },
		]);
	} finally { db.close(); }
});
