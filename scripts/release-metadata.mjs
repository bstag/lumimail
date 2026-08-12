import { createReleaseManifest } from "./release-manifest.mjs";

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SCHEMA_PATTERN = /^\d{4}$/;

export class ReleaseMetadataError extends Error {
	constructor() {
		super("Release metadata derivation failed. No release input was produced.");
		this.name = "ReleaseMetadataError";
		this.code = "RELEASE_METADATA_FAILED";
	}
}

function migrationHead(names) {
	if (!Array.isArray(names) || names.length === 0) throw new ReleaseMetadataError();
	const numbers = names.map((name) => {
		const match = /^(\d{4})_[a-z0-9_]+\.sql$/i.exec(name);
		if (!match) throw new ReleaseMetadataError();
		return Number(match[1]);
	}).sort((left, right) => left - right);
	if (numbers[0] !== 0 || new Set(numbers).size !== numbers.length ||
		numbers.some((number, index) => number !== index)) throw new ReleaseMetadataError();
	return String(numbers.at(-1)).padStart(4, "0");
}

function exactSchemaPolicy(policy) {
	if (!policy || typeof policy !== "object" ||
		JSON.stringify(Object.keys(policy).sort()) !== JSON.stringify(["format", "maximum", "minimum"]) ||
		policy.format !== "lumimail-release-schema-v1" ||
		!SCHEMA_PATTERN.test(policy.minimum ?? "") || !SCHEMA_PATTERN.test(policy.maximum ?? "") ||
		Number(policy.minimum) > Number(policy.maximum)) throw new ReleaseMetadataError();
	return policy;
}

function deterministicBuiltAt(epoch) {
	if (!/^\d{1,12}$/.test(epoch ?? "")) throw new ReleaseMetadataError();
	const milliseconds = Number(epoch) * 1000;
	const date = new Date(milliseconds);
	if (!Number.isSafeInteger(milliseconds) || Number.isNaN(date.valueOf())) throw new ReleaseMetadataError();
	return date.toISOString();
}

export function deriveReleaseMetadata({
	runGit,
	packageManifest,
	packageLock,
	nodeVersion,
	migrationNames,
	schemaPolicy,
	sourceDateEpoch,
	notes,
}) {
	try {
		if (typeof runGit !== "function" || String(runGit(["status", "--porcelain=v1"]))) {
			throw new ReleaseMetadataError();
		}
		const commit = String(runGit(["rev-parse", "HEAD"])).trim().toLowerCase();
		if (!COMMIT_PATTERN.test(commit)) throw new ReleaseMetadataError();
		const rootLock = packageLock?.packages?.[""];
		if (
			packageManifest?.name !== "email-platform" || rootLock?.name !== "email-platform" ||
			packageManifest?.version !== rootLock?.version || packageLock?.lockfileVersion !== 3
		) throw new ReleaseMetadataError();
		const requiredNode = /^>=(\d+)$/.exec(packageManifest?.engines?.node ?? "")?.[1];
		const actualNode = /^(\d+)\./.exec(nodeVersion ?? "")?.[1];
		if (!requiredNode || !actualNode || Number(actualNode) < Number(requiredNode)) throw new ReleaseMetadataError();
		const policy = exactSchemaPolicy(schemaPolicy);
		const current = migrationHead(migrationNames);
		if (Number(current) < Number(policy.minimum) || Number(current) > Number(policy.maximum)) {
			throw new ReleaseMetadataError();
		}
		const runtime = {
			node: nodeVersion,
			next: packageLock?.packages?.["node_modules/next"]?.version,
			openNext: packageLock?.packages?.["node_modules/@opennextjs/cloudflare"]?.version,
			wrangler: packageLock?.packages?.["node_modules/wrangler"]?.version,
		};
		const validated = createReleaseManifest({
			version: packageManifest.version,
			builtAt: deterministicBuiltAt(sourceDateEpoch),
			commit,
			artifactPath: "validation.tar.gz",
			artifactBytes: Buffer.alloc(0),
			schema: { minimum: policy.minimum, current, maximum: policy.maximum },
			runtime,
			notes,
		});
		return Object.freeze({
			version: validated.version,
			builtAt: validated.builtAt,
			commit: validated.commit,
			schema: validated.schema,
			runtime: validated.runtime,
			notes: validated.notes,
		});
	} catch {
		throw new ReleaseMetadataError();
	}
}
