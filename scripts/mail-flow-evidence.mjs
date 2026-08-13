import { closeSync, openSync, readSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const OBSERVATION_CLOCK_SKEW_MS = 5_000;
const FAILURE_MESSAGE = "Mail-flow evidence could not be recorded.";
const INVALID_PROOF_MESSAGE = "Received mail-flow proof is invalid.";
const MESSAGE_ID_PATTERN = /<[^<>\r\n]+>/g;

function failProof() {
	throw new Error(INVALID_PROOF_MESSAGE);
}

function normalizeMessageId(value) {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return /^<[^<>\r\n]+>$/.test(trimmed) && Buffer.byteLength(trimmed) <= 998 ? trimmed : null;
}

function normalizeReferences(value) {
	const matches = value?.match(MESSAGE_ID_PATTERN) ?? [];
	const references = [...new Set(matches.map(normalizeMessageId).filter(Boolean))];
	const canonical = references.join(" ");
	return references.length && canonical === value.trim() && Buffer.byteLength(canonical) <= 2048
		? { references, canonical }
		: null;
}

export function parseReceivedMailHeaders(path) {
	try {
		const size = statSync(path).size;
		if (size < 1 || size > MAX_FILE_BYTES) failProof();
		const bytes = Buffer.alloc(Math.min(size, MAX_HEADER_BYTES + 4));
		const descriptor = openSync(path, "r");
		let bytesRead;
		try {
			bytesRead = readSync(descriptor, bytes, 0, bytes.length, 0);
		} finally {
			closeSync(descriptor);
		}
		const headerPrefix = bytes.subarray(0, bytesRead);
		let boundary = headerPrefix.indexOf(Buffer.from("\r\n\r\n"));
		let separatorLength = 4;
		if (boundary < 0) {
			boundary = headerPrefix.indexOf(Buffer.from("\n\n"));
			separatorLength = 2;
		}
		if (boundary < 1 || boundary > MAX_HEADER_BYTES || boundary + separatorLength > headerPrefix.length) failProof();
		const text = headerPrefix.subarray(0, boundary).toString("utf8");
		if (text.includes("\0") || text.replace(/\r\n/g, "").includes("\r")) failProof();
		const unfolded = [];
		for (const line of text.split(/\r?\n/)) {
			if (/^[ \t]/.test(line)) {
				if (!unfolded.length) failProof();
				unfolded[unfolded.length - 1] += ` ${line.trim()}`;
			} else {
				if (!/^[!-9;-~]+:[ \t]*.*$/.test(line)) failProof();
				unfolded.push(line);
			}
		}
		const headers = new Map();
		for (const line of unfolded) {
			const index = line.indexOf(":");
			const name = line.slice(0, index).toLowerCase();
			if (!["message-id", "in-reply-to", "references"].includes(name)) continue;
			if (headers.has(name)) failProof();
			headers.set(name, line.slice(index + 1).trim());
		}
		const deliveredMessageId = normalizeMessageId(headers.get("message-id"));
		const deliveredInReplyTo = normalizeMessageId(headers.get("in-reply-to"));
		const deliveredReferences = normalizeReferences(headers.get("references"));
		if (!deliveredMessageId || !deliveredInReplyTo || !deliveredReferences ||
			!deliveredReferences.references.includes(deliveredInReplyTo)) failProof();
		return Object.freeze({
			deliveredMessageId,
			deliveredInReplyTo,
			deliveredReferences: deliveredReferences.canonical,
		});
	} catch {
		failProof();
	}
}

function exactOrigin(value) {
	const url = new URL(value);
	if (url.protocol !== "https:" || url.origin !== value || url.pathname !== "/" ||
		url.username || url.password || url.search || url.hash) throw new Error();
	return url.origin;
}

function safeToken(value) {
	if (typeof value !== "string" || value.length < 1 || value.length > 4096 || /\s/.test(value)) throw new Error();
	return value;
}

function exactResult(value, status) {
	const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : [];
	const dataKeys = value?.data && typeof value.data === "object" && !Array.isArray(value.data)
		? Object.keys(value.data).sort() : [];
	if (JSON.stringify(keys) !== JSON.stringify(["data", "success"]) || value.success !== true ||
		JSON.stringify(dataKeys) !== JSON.stringify(["duplicate", "outcome", "passedChecks", "recorded", "totalChecks"]) ||
		value.data.recorded !== true || typeof value.data.duplicate !== "boolean" ||
		!Number.isInteger(value.data.passedChecks) || value.data.totalChecks !== 8 ||
		value.data.passedChecks < 0 || value.data.passedChecks > 8 ||
		!(["passed", "failed"].includes(value.data.outcome)) ||
		(value.data.outcome === "passed") !== (value.data.passedChecks === 8) ||
		(value.data.duplicate ? status !== 200 : status !== 201)) throw new Error();
	return Object.freeze({ ...value.data });
}

export async function publishMailFlowProof({ origin, sessionToken, proof, fetchImpl = fetch }) {
	try {
		const response = await fetchImpl(`${exactOrigin(origin)}/api/admin/operations/evidence/mail-flow`, {
			method: "POST",
			redirect: "error",
			headers: { accept: "application/json", authorization: `Bearer ${safeToken(sessionToken)}`,
				"content-type": "application/json" },
			body: JSON.stringify(proof),
		});
		if (response.status !== 200 && response.status !== 201) throw new Error();
		return exactResult(await response.json(), response.status);
	} catch {
		throw new Error(FAILURE_MESSAGE);
	}
}

export async function runMailFlowEvidenceCommand(args, {
	stdout = console.log,
	stderr = console.error,
	publishProof = publishMailFlowProof,
	environment = process.env,
	now = () => new Date(),
} = {}) {
	try {
		if (!Array.isArray(args) || args.length !== 2 || args.some((value) => typeof value !== "string" || !value)) {
			throw new Error();
		}
		const headers = parseReceivedMailHeaders(args[0]);
		const result = await publishProof({
			origin: args[1],
			sessionToken: environment.LUMIMAIL_SESSION_TOKEN,
			proof: {
				format: "lumimail-mail-flow-proof-v1",
				...headers,
				observedAt: new Date(now().getTime() - OBSERVATION_CLOCK_SKEW_MS).toISOString(),
			},
		});
		stdout(`${result.outcome === "passed" ? "PASS" : "FAIL"}  ${result.passedChecks}/${result.totalChecks} received mail-flow checks recorded`);
		return result.outcome === "passed" ? 0 : 1;
	} catch {
		stderr(FAILURE_MESSAGE);
		return 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await runMailFlowEvidenceCommand(process.argv.slice(2));
}
