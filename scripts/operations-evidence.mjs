const FAILURE_MESSAGE = "Operational evidence could not be recorded.";

// Fixed classes only, matching the bounded operator-failure contract already used by
// the mail-flow producer. A single opaque message cannot distinguish an absent token
// from an immutable-history conflict, which leaves the operator with nothing to act on.
const LOCAL_FAILURES = {
	token: "No usable owner session token in LUMIMAIL_SESSION_TOKEN.",
	origin: "The target must be an exact HTTPS origin with no path, query, or credentials.",
	evidence: "The derived result did not match the accepted evidence shape.",
};
const RESPONSE_FAILURES = new Map([
	["401\0Unauthorized", "Recording evidence requires a valid owner session."],
	["403\0Forbidden", "Organization owner access is required."],
	["403\0Recent authentication required", "Recent owner authentication is required; sign in again."],
	["400\0Invalid evidence", "The server rejected the derived evidence as invalid."],
	["409\0Evidence already exists with a different result",
		"Evidence already exists for that observation time with a different result."],
	["500\0Evidence could not be recorded", "The server could not record the evidence."],
]);

// The expected public smoke total lives at the validation boundary rather than in
// each producer, so extending the public contract cannot leave a stale literal
// asserting readiness somewhere else. `scripts/smoke.mjs` and the F80 doctor both
// read it from here.
export const SMOKE_CHECK_COUNT = 8;

// Matches the ledger's accepted range in src/lib/operational-evidence.ts.
const MAX_TOTAL_CHECKS = 1000;

// The ledger rejects any observation later than the edge clock. A workstation
// running even fractionally ahead would therefore have its evidence refused as
// invalid, so producers stamp a conservative lower bound on when they observed
// the result. Matches the offset the mail-flow producer already uses.
export const OBSERVATION_CLOCK_SKEW_MS = 5_000;

export function observationTimestamp(now) {
	return new Date(now.getTime() - OBSERVATION_CLOCK_SKEW_MS).toISOString();
}

export class OperationalEvidencePublishError extends Error {
	constructor(message = FAILURE_MESSAGE) {
		super(message);
		this.name = "OperationalEvidencePublishError";
		this.code = "OPERATIONAL_EVIDENCE_PUBLISH_FAILED";
	}
}

/**
 * The message a producer should print for a failed publication. Only a classified
 * publisher failure keeps its specific text; anything else stays generic.
 */
export function publishFailureMessage(error) {
	return error instanceof OperationalEvidencePublishError ? error.message : FAILURE_MESSAGE;
}

/**
 * Maps an exact status plus exact Lumimail error envelope to one fixed message.
 * Any other status, shape, or text collapses to the generic failure so arbitrary
 * server text never becomes an egress path.
 */
async function classifyResponse(response) {
	try {
		const value = await response.json();
		if (!hasExactKeys(value, ["success", "error"]) || value.success !== false ||
			!hasExactKeys(value.error, ["message"]) || typeof value.error.message !== "string") {
			return new OperationalEvidencePublishError();
		}
		return new OperationalEvidencePublishError(
			RESPONSE_FAILURES.get(`${response.status}\0${value.error.message}`) ?? FAILURE_MESSAGE,
		);
	} catch {
		return new OperationalEvidencePublishError();
	}
}

function hasExactKeys(value, expected) {
	return value && typeof value === "object" && !Array.isArray(value) &&
		JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateOrigin(value) {
	if (typeof value !== "string") throw new OperationalEvidencePublishError(LOCAL_FAILURES.origin);
	const url = new URL(value);
	if (url.protocol !== "https:" || url.origin !== value || url.username || url.password ||
		url.pathname !== "/" || url.search || url.hash) {
		throw new OperationalEvidencePublishError(LOCAL_FAILURES.origin);
	}
	return url.origin;
}

function validateToken(value) {
	if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /\s/.test(value)) {
		throw new OperationalEvidencePublishError(LOCAL_FAILURES.token);
	}
	return value;
}

function validateEvidence(value) {
	if (!hasExactKeys(value, ["category", "outcome", "passedChecks", "totalChecks", "observedAt"]) ||
		!Number.isInteger(value.passedChecks) || !Number.isInteger(value.totalChecks) ||
		value.passedChecks < 0 || value.passedChecks > value.totalChecks ||
		typeof value.observedAt !== "string" || new Date(value.observedAt).toISOString() !== value.observedAt) {
		throw new OperationalEvidencePublishError(LOCAL_FAILURES.evidence);
	}
	if (value.totalChecks < 1 || value.totalChecks > MAX_TOTAL_CHECKS) {
		throw new OperationalEvidencePublishError(LOCAL_FAILURES.evidence);
	}
	const consistentOutcome = (value.outcome === "passed" && value.passedChecks === value.totalChecks) ||
		(value.outcome === "failed" && value.passedChecks < value.totalChecks);
	const validSmoke = value.category === "smoke" && value.totalChecks === SMOKE_CHECK_COUNT && consistentOutcome;
	const validRelease = value.category === "release" && value.outcome === "passed" &&
		value.passedChecks === 1 && value.totalChecks === 1;
	// Recovery archives legitimately differ in object count, so the total is derived
	// from the manifest inventory instead of being fixed here.
	const validRecovery = value.category === "recovery" && consistentOutcome;
	if (!validSmoke && !validRelease && !validRecovery) {
		throw new OperationalEvidencePublishError(LOCAL_FAILURES.evidence);
	}
	return value;
}

function validateResponse(value, status) {
	if (!hasExactKeys(value, ["success", "data"]) || value.success !== true ||
		!hasExactKeys(value.data, ["recorded", "duplicate"]) || value.data.recorded !== true ||
		typeof value.data.duplicate !== "boolean" ||
		(value.data.duplicate ? status !== 200 : status !== 201)) {
		throw new OperationalEvidencePublishError();
	}
	return Object.freeze({ recorded: true, duplicate: value.data.duplicate });
}

export async function publishOperationalEvidence({
	origin,
	sessionToken,
	evidence,
	fetchImpl = fetch,
}) {
	try {
		const safeOrigin = validateOrigin(origin);
		const token = validateToken(sessionToken);
		const safeEvidence = validateEvidence(evidence);
		const response = await fetchImpl(`${safeOrigin}/api/admin/operations/evidence`, {
			method: "POST",
			redirect: "error",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ format: "lumimail-operations-evidence-v1", ...safeEvidence }),
		});
		if (response.status !== 200 && response.status !== 201) throw await classifyResponse(response);
		return validateResponse(await response.json(), response.status);
	} catch (error) {
		// Only an already-classified failure keeps its message. Transport errors,
		// caught exceptions, and unexpected values stay generic.
		throw error instanceof OperationalEvidencePublishError
			? error
			: new OperationalEvidencePublishError();
	}
}
