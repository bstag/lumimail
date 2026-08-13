import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FORMAT = "lumimail-managed-d1-performance-v1";
const FAILURE_MESSAGE = "Managed D1 performance evidence could not be measured.";
const USAGE = "Usage: node scripts/performance-d1.mjs";
const SQL_PATH = resolve("scripts/performance-d1.sql");
const WRANGLER_CLI = resolve("node_modules/wrangler/bin/wrangler.js");
const DEFAULT_SQL = readFileSync(SQL_PATH, "utf8");
const MUTATION_PATTERN = /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH|DETACH)\b/i;
const PRIVATE_PROJECTION_PATTERN = /\b(?:from_addr|to_addr|subject|snippet|text_body|html_body|raw_r2_key|r2_key|payload|error|token_hash|password_hash|reset_email)\b/i;

class SafeManagedD1Error extends Error {
	constructor(statementIndex = null) {
		super(FAILURE_MESSAGE);
		this.name = "SafeManagedD1Error";
		this.statementIndex = statementIndex;
	}
}

function fail(statementIndex = null) {
	throw new SafeManagedD1Error(statementIndex);
}

function splitStatements(sqlText) {
	if (typeof sqlText !== "string" || sqlText.length < 1 || sqlText.length > 64 * 1024) fail();
	const statements = sqlText.replace(/^\s*--.*$/gm, "")
		.split(";").map((statement) => statement.trim()).filter(Boolean);
	if (statements.length < 1 || statements.length > 16) fail();
	for (const statement of statements) {
		if (!/^(?:SELECT|EXPLAIN QUERY PLAN\s+SELECT)\b/i.test(statement) || MUTATION_PATTERN.test(statement)) fail();
		const select = statement.replace(/^EXPLAIN QUERY PLAN\s+/i, "");
		const projection = select.slice(6, select.search(/\bFROM\b/i));
		if (!projection || PRIVATE_PROJECTION_PATTERN.test(projection)) fail();
	}
	return statements;
}

function defaultRunWrangler(args) {
	return execFileSync(process.execPath, [WRANGLER_CLI, ...args], {
		cwd: resolve("."),
		encoding: "utf8",
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 1024 * 1024,
	});
}

function parseResult(output, index) {
	let parsed;
	try {
		parsed = JSON.parse(output);
	} catch {
		fail(index);
	}
	if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0]?.success !== true ||
		!Array.isArray(parsed[0].results) || !parsed[0].meta ||
		!Number.isFinite(parsed[0].meta.timings?.sql_duration_ms) ||
		!Number.isInteger(parsed[0].meta.rows_read) || parsed[0].meta.rows_read < 0 ||
		parsed[0].meta.rows_written !== 0 || typeof parsed[0].meta.served_by_region !== "string" ||
		!parsed[0].meta.served_by_region) fail(index);
	return Object.freeze({
		index,
		sqlDurationMs: parsed[0].meta.timings.sql_duration_ms,
		rowsRead: parsed[0].meta.rows_read,
		rowsWritten: 0,
		region: parsed[0].meta.served_by_region,
		results: Object.freeze(parsed[0].results),
	});
}

export function runManagedD1Evidence({
	sqlText = DEFAULT_SQL,
	runWrangler = defaultRunWrangler,
	now = () => new Date(),
} = {}) {
	try {
		const observed = now();
		if (!(observed instanceof Date) || Number.isNaN(observed.valueOf())) fail();
		const statements = splitStatements(sqlText);
		const results = statements.map((statement, index) => {
			let output;
			try {
				output = runWrangler(["d1", "execute", "DB", "--remote", "--command", statement, "--json"]);
			} catch {
				fail(index + 1);
			}
			return parseResult(output, index + 1);
		});
		const regions = [...new Set(results.map((result) => result.region))].sort();
		return Object.freeze({
			format: FORMAT,
			observedAt: observed.toISOString(),
			statementCount: results.length,
			totalSqlDurationMs: Math.round(results.reduce((total, result) => total + result.sqlDurationMs, 0) * 1000) / 1000,
			totalRowsRead: results.reduce((total, result) => total + result.rowsRead, 0),
			totalRowsWritten: 0,
			regions: Object.freeze(regions),
			statements: Object.freeze(results),
		});
	} catch (error) {
		if (error instanceof SafeManagedD1Error) throw error;
		fail();
	}
}

export function runManagedD1EvidenceCommand(args, {
	stdout = console.log,
	stderr = console.error,
	run = runManagedD1Evidence,
} = {}) {
	if (!Array.isArray(args) || args.length !== 0) {
		stderr(USAGE);
		return 1;
	}
	try {
		stdout(JSON.stringify(run(), null, 2));
		return 0;
	} catch {
		stderr(FAILURE_MESSAGE);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = runManagedD1EvidenceCommand(process.argv.slice(2));
}
