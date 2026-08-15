import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/migrations/0032_add_operational_evidence.sql"), "utf8");

describe("0032 operational evidence migration", () => {
	it("creates only fixed content-free fields, scoped indexes, and atomic retention", () => {
		const db = new DatabaseSync(":memory:");
		try {
			db.exec(`
				PRAGMA foreign_keys = ON;
				CREATE TABLE organizations (id text PRIMARY KEY NOT NULL);
				INSERT INTO organizations VALUES ('org_1');
			`);
			db.exec(migration);
			const columns = (db.prepare("PRAGMA table_info(operational_evidence)").all() as Array<{ name: string }>).map((row) => row.name);
			expect(columns).toEqual([
				"id", "organization_id", "actor_user_id", "category", "outcome",
				"passed_checks", "total_checks", "observed_at", "recorded_at",
			]);
			expect(columns.join(" ")).not.toMatch(/payload|detail|message|address|token|secret|url|commit|resource/i);

			const indexes = (db.prepare("PRAGMA index_list(operational_evidence)").all() as Array<{ name: string }>).map((row) => row.name);
			expect(indexes).toEqual(expect.arrayContaining([
				"operational_evidence_org_category_observed_idx",
				"operational_evidence_org_recorded_idx",
			]));

			const insert = db.prepare(`INSERT INTO operational_evidence
				(id, organization_id, actor_user_id, category, outcome, passed_checks, total_checks, observed_at, recorded_at)
				VALUES (?, 'org_1', 'usr_owner', 'smoke', 'passed', 6, 6, ?, ?)`);
			for (let index = 0; index < 205; index += 1) insert.run(`ope_${index}`, index + 1, index + 1);
			expect(db.prepare("SELECT COUNT(*) AS count FROM operational_evidence WHERE organization_id = 'org_1'").get())
				.toEqual({ count: 200 });
			expect(db.prepare("SELECT MIN(recorded_at) AS oldest FROM operational_evidence").get())
				.toEqual({ oldest: 6 });
		} finally {
			db.close();
		}
	});
});
