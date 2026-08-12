const FAILURE_MESSAGE = "Operational evidence could not be recorded.";

export class OperationalEvidencePublishError extends Error {
	constructor() {
		super(FAILURE_MESSAGE);
		this.name = "OperationalEvidencePublishError";
		this.code = "OPERATIONAL_EVIDENCE_PUBLISH_FAILED";
	}
}

function hasExactKeys(value, expected) {
	return value && typeof value === "object" && !Array.isArray(value) &&
		JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateOrigin(value) {
	if (typeof value !== "string") throw new OperationalEvidencePublishError();
	const url = new URL(value);
	if (url.protocol !== "https:" || url.origin !== value || url.username || url.password ||
		url.pathname !== "/" || url.search || url.hash) throw new OperationalEvidencePublishError();
	return url.origin;
}

function validateToken(value) {
	if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /\s/.test(value)) {
		throw new OperationalEvidencePublishError();
	}
	return value;
}

function validateEvidence(value) {
	if (!hasExactKeys(value, ["category", "outcome", "passedChecks", "totalChecks", "observedAt"]) ||
		!Number.isInteger(value.passedChecks) || !Number.isInteger(value.totalChecks) ||
		value.passedChecks < 0 || value.passedChecks > value.totalChecks ||
		typeof value.observedAt !== "string" || new Date(value.observedAt).toISOString() !== value.observedAt) {
		throw new OperationalEvidencePublishError();
	}
	const validSmoke = value.category === "smoke" && value.totalChecks === 6 &&
		((value.outcome === "passed" && value.passedChecks === 6) ||
			(value.outcome === "failed" && value.passedChecks < 6));
	const validRelease = value.category === "release" && value.outcome === "passed" &&
		value.passedChecks === 1 && value.totalChecks === 1;
	if (!validSmoke && !validRelease) throw new OperationalEvidencePublishError();
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
		if (response.status !== 200 && response.status !== 201) throw new OperationalEvidencePublishError();
		return validateResponse(await response.json(), response.status);
	} catch {
		throw new OperationalEvidencePublishError();
	}
}
