import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const GIT_COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const PLACEHOLDER_PATTERN = /^(?:ACCOUNT_ID|BUCKET_NAME|D1_ID|STAGING_[A-Z0-9_]+|WORKER_NAME|YOUR_[A-Z0-9_]+|CHANGE_ME|REPLACE_ME|TODO|TBD|<[^>]+>)$/i;

function resolvedName(label) {
	return z.string().refine(
		(value) =>
			value === value.trim() &&
			RESOURCE_NAME_PATTERN.test(value) &&
			!PLACEHOLDER_PATTERN.test(value),
		{ message: `must be a resolved ${label}` },
	);
}

const nullableNonEmpty = z.union([
	z.string().min(1, "must be non-empty or null"),
	z.null(),
]);
const observedSize = z
	.number()
	.int("must be a non-negative integer")
	.nonnegative("must be a non-negative integer");
const sha256 = z.string().regex(HASH_PATTERN, "must be a SHA-256 hex digest");
const strictObject = (shape) => z.strictObject(shape);

const objectEntrySchema = strictObject({
	key: z.string().refine(
		(value) => {
			const segments = value.split("/");
			return (
				(segments[0] === "attachments" || segments[0] === "inbound") &&
				segments.length > 1 &&
				segments.every((segment) =>
					segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes("\\"),
				)
			);
		},
		{ message: "must be a safe Lumimail R2 key" },
	),
	size: observedSize,
	etag: nullableNonEmpty,
	sha256,
});

const manifestSchema = strictObject({
	format: z.literal("lumimail-recovery-v1", {
		error: "must equal lumimail-recovery-v1",
	}),
	product: z.literal("lumimail", { error: "must equal lumimail" }),
	createdAt: z.string().refine(
		(value) => {
			const parsed = new Date(value);
			return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
		},
		{ message: "must be an exact UTC ISO timestamp" },
	),
	source: strictObject({
		accountId: z
			.string()
			.regex(ACCOUNT_ID_PATTERN, "must be a Cloudflare account ID"),
		worker: strictObject({
			name: resolvedName("Worker name"),
			versionId: z
				.string()
				.regex(UUID_PATTERN, "must be a Cloudflare Worker version UUID"),
			scriptEtag: z
				.string()
				.regex(HASH_PATTERN, "must be a Cloudflare Worker script ETag"),
			compatibilityDate: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
		}),
		d1: strictObject({
			id: z.string().regex(UUID_PATTERN, "must be a Cloudflare D1 UUID"),
			name: resolvedName("D1 name"),
			bookmark: nullableNonEmpty,
		}),
		r2: strictObject({
			bucketName: resolvedName("R2 bucket name"),
		}),
	}),
	application: strictObject({
		gitCommit: z
			.string()
			.regex(GIT_COMMIT_PATTERN, "must be a Git commit hex digest"),
		schemaVersion: z
			.string()
			.regex(/^\d{4}$/, "must be a four-digit migration prefix"),
	}),
	database: strictObject({
		path: z.literal("d1.sql", { error: "must equal d1.sql" }),
		size: observedSize,
		sha256,
	}),
	objects: z.array(objectEntrySchema),
}).superRefine((manifest, context) => {
	const keys = manifest.objects.map((entry) => entry.key);
	if (new Set(keys).size !== keys.length) {
		context.addIssue({
			code: "custom",
			path: ["objects"],
			message: "object keys must be unique",
		});
	}
});

export class RecoveryManifestError extends Error {
	constructor(problems) {
		const copiedProblems = Object.freeze([...problems]);
		const noun = copiedProblems.length === 1 ? "problem" : "problems";
		super(
			`Recovery manifest is invalid (${copiedProblems.length} ${noun}). No changes were made.`,
		);
		this.name = "RecoveryManifestError";
		this.code = "INVALID_RECOVERY_MANIFEST";
		this.problems = copiedProblems;
	}
}

function issueToProblem(issue) {
	const path = issue.path.length > 0 ? issue.path.join(".") : "manifest";
	if (issue.code === "unrecognized_keys") {
		return `${path}: unknown fields are not allowed`;
	}
	return `${path}: ${issue.message}`;
}

function deepFreeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

function normalizedManifest(manifest) {
	return {
		...manifest,
		source: {
			...manifest.source,
			accountId: manifest.source.accountId.toLowerCase(),
			worker: {
				...manifest.source.worker,
				versionId: manifest.source.worker.versionId.toLowerCase(),
				scriptEtag: manifest.source.worker.scriptEtag.toLowerCase(),
			},
			d1: {
				...manifest.source.d1,
				id: manifest.source.d1.id.toLowerCase(),
			},
			r2: { ...manifest.source.r2 },
		},
		application: {
			...manifest.application,
			gitCommit: manifest.application.gitCommit.toLowerCase(),
		},
		database: {
			...manifest.database,
			sha256: manifest.database.sha256.toLowerCase(),
		},
		objects: manifest.objects
			.map((entry) => ({ ...entry, sha256: entry.sha256.toLowerCase() }))
			.sort((left, right) => left.key.localeCompare(right.key)),
	};
}

export function parseRecoveryManifest(jsonOrValue) {
	let value = jsonOrValue;
	if (typeof jsonOrValue === "string") {
		try {
			value = JSON.parse(jsonOrValue);
		} catch {
			throw new RecoveryManifestError(["manifest must be valid JSON"]);
		}
	}

	const result = manifestSchema.safeParse(value);
	if (!result.success) {
		throw new RecoveryManifestError(result.error.issues.map(issueToProblem));
	}
	return deepFreeze(normalizedManifest(result.data));
}

function canonicalValue(value) {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonicalValue(value[key])]),
		);
	}
	return value;
}

export function canonicalizeRecoveryManifest(jsonOrValue) {
	const manifest = parseRecoveryManifest(jsonOrValue);
	return `${JSON.stringify(canonicalValue(manifest))}\n`;
}

function verifyFile(backupDirectory, relativePath, expected, problems) {
	try {
		const bytes = readFileSync(
			join(backupDirectory, ...relativePath.split("/")),
		);
		if (bytes.length !== expected.size) {
			problems.push(`${relativePath}: size ${bytes.length} != ${expected.size}`);
		}
		const digest = createHash("sha256").update(bytes).digest("hex");
		if (digest !== expected.sha256) {
			problems.push(`${relativePath}: checksum mismatch`);
		}
	} catch {
		problems.push(`${relativePath}: file missing from backup`);
	}
}

export function verifyRecoveryDirectory(backupDirectory) {
	let manifestJson;
	try {
		manifestJson = readFileSync(join(backupDirectory, "manifest.json"), "utf8");
	} catch {
		throw new RecoveryManifestError([
			"manifest.json: file missing from backup",
		]);
	}

	const manifest = parseRecoveryManifest(manifestJson);
	const problems = [];
	verifyFile(backupDirectory, manifest.database.path, manifest.database, problems);
	for (const entry of manifest.objects) {
		verifyFile(backupDirectory, entry.key, entry, problems);
	}
	return {
		checkedDatabase: 1,
		checkedObjects: manifest.objects.length,
		problems,
	};
}
