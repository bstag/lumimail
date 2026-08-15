import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { verifyRecoveryDirectory } from "./recovery-manifest.mjs";

const POLICY_FILE = "retention-policy.json";
const FORMAT = "lumimail-recovery-retention-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const POLICY_KEYS = ["cleanupCompletedAt", "destroyAfter", "format", "retentionDays", "updatedAt"];

function exactIso(value) {
	if (typeof value !== "string") return false;
	const parsed = new Date(value);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function assertDays(days) {
	if (!Number.isInteger(days) || days < 1 || days > 3650) {
		throw new Error("Recovery retention days must be an integer from 1 through 3650");
	}
}

function parseExistingPolicy(path) {
	if (!existsSync(path)) return null;
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		const keys = value && typeof value === "object" && !Array.isArray(value)
			? Object.keys(value).sort() : [];
		assertDays(value?.retentionDays);
		if (JSON.stringify(keys) !== JSON.stringify(POLICY_KEYS) || value.format !== FORMAT ||
			!exactIso(value.updatedAt) ||
			!((value.cleanupCompletedAt === null && value.destroyAfter === null) ||
				(exactIso(value.cleanupCompletedAt) && exactIso(value.destroyAfter)))) {
			throw new Error();
		}
		if (value.cleanupCompletedAt !== null) {
			const expected = new Date(new Date(value.cleanupCompletedAt).getTime() + value.retentionDays * DAY_MS).toISOString();
			if (value.destroyAfter !== expected) throw new Error();
		}
		return value;
	} catch {
		throw new Error("Recovery retention existing policy is invalid");
	}
}

export function setRecoveryRetention({
	archiveDirectory,
	days,
	cleanupCompletedNow = false,
	now = () => new Date(),
	renameFile = renameSync,
}) {
	assertDays(days);
	const directory = resolve(archiveDirectory);
	let verification;
	try {
		verification = verifyRecoveryDirectory(directory);
	} catch {
		throw new Error("Recovery retention archive integrity verification failed");
	}
	if (verification.problems.length > 0) {
		throw new Error("Recovery retention archive integrity verification failed");
	}
	const policyPath = join(directory, POLICY_FILE);
	const existing = parseExistingPolicy(policyPath);
	const observed = now();
	if (!(observed instanceof Date) || Number.isNaN(observed.valueOf())) {
		throw new Error("Recovery retention observation time is invalid");
	}
	const updatedAt = observed.toISOString();
	const cleanupCompletedAt = existing?.cleanupCompletedAt ?? (cleanupCompletedNow ? updatedAt : null);
	const destroyAfter = cleanupCompletedAt === null
		? null
		: new Date(new Date(cleanupCompletedAt).getTime() + days * DAY_MS).toISOString();
	const policy = Object.freeze({
		cleanupCompletedAt,
		destroyAfter,
		format: FORMAT,
		retentionDays: days,
		updatedAt,
	});
	const partialPath = join(directory, `.retention-policy.partial-${randomUUID()}.json`);
	try {
		writeFileSync(partialPath, `${JSON.stringify(policy)}\n`, { flag: "wx" });
		renameFile(partialPath, policyPath);
	} catch {
		rmSync(partialPath, { force: true });
		throw new Error("Recovery retention policy could not be updated");
	}
	return policy;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [archiveDirectory, daysText, flag] = process.argv.slice(2);
	if (!archiveDirectory || !daysText || (flag !== undefined && flag !== "--cleanup-completed-now") ||
		process.argv.slice(2).length > 3) {
		console.error("Usage: node scripts/recovery-retention.mjs <archive-directory> <days> [--cleanup-completed-now]");
		process.exitCode = 1;
	} else {
		try {
			const policy = setRecoveryRetention({
				archiveDirectory,
				days: Number(daysText),
				cleanupCompletedNow: flag === "--cleanup-completed-now",
			});
			console.log(JSON.stringify(policy, null, 2));
		} catch (error) {
			console.error(error instanceof Error ? error.message : "Recovery retention policy failed");
			process.exitCode = 1;
		}
	}
}
