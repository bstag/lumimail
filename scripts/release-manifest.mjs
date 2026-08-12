import { createHash, sign, verify } from "node:crypto";
import { z } from "zod";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SCHEMA_PATTERN = /^\d{4}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SAFE_BASENAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,199}$/i;

const strictObject = (shape) => z.strictObject(shape);
const schemaVersion = z.string().regex(SCHEMA_PATTERN, "must be a four-digit schema version");

const manifestSchema = strictObject({
	format: z.literal("lumimail-release-v1", { error: "must equal lumimail-release-v1" }),
	product: z.literal("lumimail", { error: "must equal lumimail" }),
	version: z.string().regex(SEMVER_PATTERN, "must be semantic versioning"),
	builtAt: z.string().refine((value) => {
		const parsed = new Date(value);
		return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
	}, { message: "must be an exact UTC ISO timestamp" }),
	commit: z.string().regex(COMMIT_PATTERN, "must be a Git commit hex digest"),
	artifact: strictObject({
		path: z.string().regex(SAFE_BASENAME_PATTERN, "must be a safe artifact basename"),
		size: z.number().int().nonnegative(),
		sha256: z.string().regex(SHA256_PATTERN, "must be a SHA-256 hex digest"),
	}),
	schema: strictObject({
		minimum: schemaVersion,
		current: schemaVersion,
		maximum: schemaVersion,
	}),
	runtime: strictObject({
		node: z.string().regex(VERSION_PATTERN, "must be a resolved Node version"),
		next: z.string().regex(VERSION_PATTERN, "must be a resolved Next.js version"),
		openNext: z.string().regex(VERSION_PATTERN, "must be a resolved OpenNext version"),
		wrangler: z.string().regex(VERSION_PATTERN, "must be a resolved Wrangler version"),
	}),
	notes: z.array(
		z.string().min(1).max(500).refine((value) => value === value.trim() && !/[\r\n]/.test(value), {
			message: "must be a trimmed single-line release note",
		}),
	).max(100),
}).superRefine((manifest, context) => {
	const minimum = Number(manifest.schema.minimum);
	const current = Number(manifest.schema.current);
	const maximum = Number(manifest.schema.maximum);
	if (!(minimum <= current && current <= maximum)) {
		context.addIssue({ code: "custom", path: ["schema"], message: "must satisfy minimum <= current <= maximum" });
	}
});

const signatureSchema = strictObject({
	format: z.literal("lumimail-release-signature-v1", { error: "must equal lumimail-release-signature-v1" }),
	algorithm: z.literal("Ed25519", { error: "must equal Ed25519" }),
	keyId: z.string().regex(KEY_ID_PATTERN, "must be a safe key ID"),
	manifestSha256: z.string().regex(SHA256_PATTERN, "must be a SHA-256 hex digest"),
	signature: z.string().min(1).refine((value) => {
		try {
			return Buffer.from(value, "base64").toString("base64") === value;
		} catch {
			return false;
		}
	}, { message: "must be canonical Base64" }),
});

export class ReleaseManifestError extends Error {
	constructor(problems) {
		const copied = Object.freeze([...problems]);
		super(`Release manifest is invalid (${copied.length} ${copied.length === 1 ? "problem" : "problems"}).`);
		this.name = "ReleaseManifestError";
		this.code = "INVALID_RELEASE_MANIFEST";
		this.problems = copied;
	}
}

export class ReleaseVerificationError extends Error {
	constructor() {
		super("Release verification failed. No release action was performed.");
		this.name = "ReleaseVerificationError";
		this.code = "RELEASE_VERIFICATION_FAILED";
	}
}

function issueProblem(issue) {
	const path = issue.path.length > 0 ? issue.path.join(".") : "manifest";
	return `${path}: ${issue.code === "unrecognized_keys" ? "unknown fields are not allowed" : issue.message}`;
}

function deepFreeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

function normalizeManifest(value) {
	return {
		format: value.format,
		product: value.product,
		version: value.version,
		builtAt: value.builtAt,
		commit: value.commit.toLowerCase(),
		artifact: {
			path: value.artifact.path,
			size: value.artifact.size,
			sha256: value.artifact.sha256.toLowerCase(),
		},
		schema: { ...value.schema },
		runtime: { ...value.runtime },
		notes: [...value.notes],
	};
}

export function parseReleaseManifest(value) {
	let input = value;
	if (typeof value === "string") {
		try {
			input = JSON.parse(value);
		} catch {
			throw new ReleaseManifestError(["manifest: must be valid JSON"]);
		}
	}
	const result = manifestSchema.safeParse(input);
	if (!result.success) throw new ReleaseManifestError(result.error.issues.map(issueProblem));
	return deepFreeze(normalizeManifest(result.data));
}

export function canonicalizeReleaseManifest(value) {
	return `${JSON.stringify(parseReleaseManifest(value), null, 2)}\n`;
}

export function createReleaseManifest(input) {
	const expectedKeys = ["artifactBytes", "artifactPath", "builtAt", "commit", "notes", "runtime", "schema", "version"];
	if (!input || typeof input !== "object" ||
		JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expectedKeys)) {
		throw new ReleaseManifestError(["manifest input: exact fields are required"]);
	}
	const { version, builtAt, commit, artifactPath, artifactBytes, schema, runtime, notes } = input;
	if (!(artifactBytes instanceof Uint8Array)) {
		throw new ReleaseManifestError(["artifactBytes: exact bytes are required"]);
	}
	return parseReleaseManifest({
		format: "lumimail-release-v1",
		product: "lumimail",
		version,
		builtAt,
		commit,
		artifact: {
			path: artifactPath,
			size: artifactBytes.byteLength,
			sha256: createHash("sha256").update(artifactBytes).digest("hex"),
		},
		schema,
		runtime,
		notes,
	});
}

function manifestDigest(manifest) {
	return createHash("sha256").update(canonicalizeReleaseManifest(manifest)).digest("hex");
}

function parseSignature(value) {
	let input = value;
	if (typeof value === "string") {
		try {
			input = JSON.parse(value);
		} catch {
			throw new ReleaseVerificationError();
		}
	}
	const result = signatureSchema.safeParse(input);
	if (!result.success) throw new ReleaseVerificationError();
	return deepFreeze({ ...result.data, manifestSha256: result.data.manifestSha256.toLowerCase() });
}

export function signReleaseManifest(manifest, privateKey, keyId) {
	if (!KEY_ID_PATTERN.test(keyId ?? "") || !privateKey) throw new ReleaseVerificationError();
	const canonical = canonicalizeReleaseManifest(manifest);
	try {
		return deepFreeze({
			format: "lumimail-release-signature-v1",
			algorithm: "Ed25519",
			keyId,
			manifestSha256: createHash("sha256").update(canonical).digest("hex"),
			signature: sign(null, Buffer.from(canonical), privateKey).toString("base64"),
		});
	} catch {
		throw new ReleaseVerificationError();
	}
}

export function verifySignedRelease({ manifest, signature, artifactBytes, trustedPublicKeys, expected }) {
	try {
		const parsedManifest = parseReleaseManifest(manifest);
		const parsedSignature = parseSignature(signature);
		const publicKey = trustedPublicKeys?.[parsedSignature.keyId];
		if (!publicKey || !(artifactBytes instanceof Uint8Array)) throw new Error("invalid input");
		const canonical = canonicalizeReleaseManifest(parsedManifest);
		const digest = manifestDigest(parsedManifest);
		const artifactDigest = createHash("sha256").update(artifactBytes).digest("hex");
		const schemaVersion = expected?.schemaVersion;
		if (
			parsedSignature.manifestSha256 !== digest ||
			!verify(null, Buffer.from(canonical), publicKey, Buffer.from(parsedSignature.signature, "base64")) ||
			parsedManifest.product !== expected?.product ||
			parsedManifest.version !== expected?.version ||
			!SCHEMA_PATTERN.test(schemaVersion ?? "") ||
			Number(schemaVersion) < Number(parsedManifest.schema.minimum) ||
			Number(schemaVersion) > Number(parsedManifest.schema.maximum) ||
			artifactBytes.byteLength !== parsedManifest.artifact.size ||
			artifactDigest !== parsedManifest.artifact.sha256
		) throw new Error("verification mismatch");
		return deepFreeze({
			verified: true,
			version: parsedManifest.version,
			commit: parsedManifest.commit,
			keyId: parsedSignature.keyId,
			schemaVersion,
			artifactSize: artifactBytes.byteLength,
			artifactSha256: artifactDigest,
		});
	} catch {
		throw new ReleaseVerificationError();
	}
}
