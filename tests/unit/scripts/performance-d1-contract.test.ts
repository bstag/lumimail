import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());

function statements() {
	const sql = readFileSync(resolve(root, "scripts/performance-d1.sql"), "utf8")
		.replace(/^\s*--.*$/gm, "");
	return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

describe("managed D1 performance evidence", () => {
	it("contains only fixed read-only SELECT and EXPLAIN statements", () => {
		const queries = statements();
		expect(queries).toHaveLength(8);
		for (const query of queries) {
			expect(query).toMatch(/^(?:SELECT|EXPLAIN QUERY PLAN\s+SELECT)\b/i);
			expect(query).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH|DETACH)\b/i);
		}
	});

	it("does not select private message, address, credential, or error fields", () => {
		const sql = statements().join("\n");
		expect(sql).not.toMatch(/\b(?:from_addr|to_addr|text_body|html_body|raw_r2_key|r2_key|payload|error|token_hash|password_hash|reset_email)\b/i);
	});

	it("is exposed only as the fixed remote D1 npm command", () => {
		const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
		expect(packageJson.scripts["performance:d1"]).toBe("node scripts/performance-d1.mjs");
	});
});
