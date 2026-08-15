import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
	process.cwd(), "drizzle/migrations/0034_add_oauth_refresh_replay_protection.sql",
), "utf8");

describe("0034 OAuth refresh replay migration", () => {
	it("stores only token digests and atomically rejects duplicate use", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec(migration);
			const columns = (db.prepare("PRAGMA table_info(oauth_refresh_token_uses)").all() as Array<{ name: string }>)
				.map((row) => row.name);
			expect(columns).toEqual(["token_hash", "claim_id", "used_at", "expires_at"]);
			expect(columns).not.toContain("refresh_token");
			db.prepare("INSERT INTO oauth_refresh_token_uses VALUES (?, ?, ?, ?)")
				.run("digest", "claim_1", 1, 2);
			expect(() => db.prepare("INSERT INTO oauth_refresh_token_uses VALUES (?, ?, ?, ?)")
				.run("digest", "claim_2", 1, 2)).toThrow(/UNIQUE/);
			const indexes = db.prepare("PRAGMA index_list(oauth_refresh_token_uses)").all() as Array<{ name: string }>;
			expect(indexes.map((row) => row.name)).toContain("oauth_refresh_token_uses_expiry_idx");
		} finally {
			db.close();
		}
	});
});
