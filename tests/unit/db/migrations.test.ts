import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@/db/schema";
import {
	buildDrizzleSchemaContract,
	diffSchemaContracts,
	readSqliteSchemaContract,
	type SchemaContract,
} from "./schema-contract";

const projectRoot = resolve(process.cwd());
const wranglerCli = resolve(projectRoot, "node_modules/wrangler/bin/wrangler.js");

function findSqliteDatabase(directory: string): string {
	for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".sqlite")) {
			return resolve(entry.parentPath, entry.name);
		}
	}
	throw new Error(`Wrangler did not create a local SQLite database under ${directory}`);
}

describe("executable D1 migrations", () => {
	let persistenceDirectory: string;
	let actual: SchemaContract;

	beforeAll(() => {
		persistenceDirectory = mkdtempSync(join(tmpdir(), "lumimail-schema-contract-"));
		execFileSync(
			process.execPath,
			[
				wranglerCli,
				"d1",
				"migrations",
				"apply",
				"DB",
				"--local",
				"--persist-to",
				persistenceDirectory,
			],
			{
				cwd: projectRoot,
				env: { ...process.env, WRANGLER_LOG: "none" },
				stdio: "pipe",
			},
		);

		const database = new DatabaseSync(findSqliteDatabase(persistenceDirectory), {
			readOnly: true,
		});
		try {
			actual = readSqliteSchemaContract(database);
		} finally {
			database.close();
		}
	}, 120_000);

	afterAll(() => {
		if (persistenceDirectory) {
			rmSync(persistenceDirectory, { recursive: true, force: true });
		}
	});

	it("produce the complete Drizzle schema from an empty local D1 database", () => {
		const expected = buildDrizzleSchemaContract(schema);
		expect(diffSchemaContracts(expected, actual)).toEqual([]);
	});

	it("fail when executable SQL omits a required structure even if snapshots are unchanged", () => {
		const expected = buildDrizzleSchemaContract(schema);
		const withoutPasswordResetTable = {
			...actual,
			tables: actual.tables.filter((table) => table.name !== "password_reset_tokens"),
		};

		expect(diffSchemaContracts(expected, withoutPasswordResetTable)).toContain(
			"Missing table: password_reset_tokens",
		);
	});
});
