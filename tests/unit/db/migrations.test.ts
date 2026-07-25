import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const migrationsSource = resolve(projectRoot, "drizzle/migrations");

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function migrationFilenames(): string[] {
	return readdirSync(migrationsSource)
		.filter((name) => name.endsWith(".sql"))
		.sort();
}

/**
 * Wrangler resolves `migrations_dir` relative to its configuration file, so each
 * stage gets its own project directory holding only the migrations it should see.
 * The database identity stays constant so a shared `--persist-to` directory keeps
 * the `d1_migrations` bookkeeping between stages.
 */
function makeMigrationProject(filenames: string[], overrides: Record<string, string> = {}): string {
	const projectDirectory = makeTemporaryDirectory("lumimail-schema-project-");
	const migrationsDirectory = join(projectDirectory, "migrations");
	mkdirSync(migrationsDirectory);

	for (const filename of filenames) {
		const destination = join(migrationsDirectory, filename);
		if (filename in overrides) {
			writeFileSync(destination, overrides[filename]);
		} else {
			copyFileSync(join(migrationsSource, filename), destination);
		}
	}

	writeFileSync(
		join(projectDirectory, "wrangler.json"),
		JSON.stringify({
			name: "lumimail-schema-contract",
			d1_databases: [
				{
					binding: "DB",
					database_name: "lumimail-schema-contract",
					database_id: "00000000-0000-4000-8000-000000000000",
					migrations_dir: "migrations",
				},
			],
		}),
	);

	return projectDirectory;
}

function applyMigrations(projectDirectory: string, persistenceDirectory: string): void {
	execFileSync(
		process.execPath,
		[
			wranglerCli,
			"d1",
			"migrations",
			"apply",
			"DB",
			"--local",
			"--config",
			join(projectDirectory, "wrangler.json"),
			"--persist-to",
			persistenceDirectory,
		],
		{
			cwd: projectRoot,
			env: { ...process.env, WRANGLER_LOG: "none" },
			stdio: "pipe",
		},
	);
}

function findSqliteDatabase(directory: string): string {
	for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".sqlite")) {
			return resolve(entry.parentPath, entry.name);
		}
	}
	throw new Error(`Wrangler did not create a local SQLite database under ${directory}`);
}

function readContract(persistenceDirectory: string): SchemaContract {
	const database = new DatabaseSync(findSqliteDatabase(persistenceDirectory), {
		readOnly: true,
	});
	try {
		return readSqliteSchemaContract(database);
	} finally {
		database.close();
	}
}

/** Applies every migration to one empty database and returns the resulting structure. */
function migrateFresh(filenames: string[], overrides: Record<string, string> = {}): SchemaContract {
	const persistenceDirectory = makeTemporaryDirectory("lumimail-schema-fresh-");
	applyMigrations(makeMigrationProject(filenames, overrides), persistenceDirectory);
	return readContract(persistenceDirectory);
}

/**
 * Applies `prefix` to an empty database, then applies the full set to that same
 * database, mirroring an already-deployed database advancing to the current release.
 */
function migrateUpgrade(
	prefix: string[],
	filenames: string[],
	overrides: Record<string, string> = {},
): SchemaContract {
	const persistenceDirectory = makeTemporaryDirectory("lumimail-schema-upgrade-");
	applyMigrations(makeMigrationProject(prefix), persistenceDirectory);
	applyMigrations(makeMigrationProject(filenames, overrides), persistenceDirectory);
	return readContract(persistenceDirectory);
}

describe("executable D1 migrations", () => {
	let allMigrations: string[];
	let fresh: SchemaContract;

	beforeAll(() => {
		allMigrations = migrationFilenames();
		fresh = migrateFresh(allMigrations);
	}, 180_000);

	afterAll(() => {
		for (const directory of temporaryDirectories) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("produce the complete Drizzle schema from an empty local D1 database", () => {
		const expected = buildDrizzleSchemaContract(schema);
		expect(diffSchemaContracts(expected, fresh)).toEqual([]);
	});

	it("fail when executable SQL omits a required structure even if snapshots are unchanged", () => {
		const expected = buildDrizzleSchemaContract(schema);
		const withoutPasswordResetTable = {
			...fresh,
			tables: fresh.tables.filter((table) => table.name !== "password_reset_tokens"),
		};

		expect(diffSchemaContracts(expected, withoutPasswordResetTable)).toContain(
			"Missing table: password_reset_tokens",
		);
	});

	it("produce the complete Drizzle schema when an earlier database is upgraded", () => {
		const prefix = allMigrations.slice(0, -3);
		expect(prefix.length).toBeGreaterThan(0);
		expect(prefix.length).toBeLessThan(allMigrations.length);

		const expected = buildDrizzleSchemaContract(schema);
		expect(diffSchemaContracts(expected, migrateUpgrade(prefix, allMigrations))).toEqual([]);
	}, 180_000);

	it(
		"detect a migration that only takes effect on a fresh database",
		() => {
			// The real defect this guards against: editing an already-applied migration
			// instead of adding a new one. A fresh database gets the change because the
			// file is executed for the first time; a deployed database never re-runs it.
			const [firstMigration] = allMigrations;
			const edited = readFileSync(join(migrationsSource, firstMigration), "utf8").replace(
				"CREATE TABLE `mailboxes` (",
				"CREATE TABLE `mailboxes` (\n\t`upgrade_probe` text,",
			);
			const overrides = { [firstMigration]: edited };

			const editedFresh = migrateFresh(allMigrations, overrides);
			const editedUpgrade = migrateUpgrade(allMigrations, allMigrations, overrides);

			// The edit reaches a fresh database.
			const freshMailboxes = editedFresh.tables.find((table) => table.name === "mailboxes");
			expect(freshMailboxes?.columns.map((column) => column.name)).toContain("upgrade_probe");

			// It never reaches an already-migrated database, and the staged check says so.
			expect(diffSchemaContracts(editedFresh, editedUpgrade)).toContain(
				"Missing column: mailboxes.upgrade_probe",
			);
		},
		240_000,
	);
});
