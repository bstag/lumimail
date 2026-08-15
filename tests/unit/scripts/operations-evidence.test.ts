import { describe, expect, it, vi } from "vitest";

import {
	OperationalEvidencePublishError,
	publishOperationalEvidence,
	SMOKE_CHECK_COUNT,
} from "../../../scripts/operations-evidence.mjs";

const evidence = {
	category: "smoke",
	outcome: "passed",
	passedChecks: SMOKE_CHECK_COUNT,
	totalChecks: SMOKE_CHECK_COUNT,
	observedAt: "2026-08-12T20:00:00.000Z",
};

describe("operational evidence publisher", () => {
	it("posts the exact versioned evidence shape with a runtime bearer", async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
			success: true,
			data: { recorded: true, duplicate: false },
		}), { status: 201, headers: { "content-type": "application/json" } }));

		await expect(publishOperationalEvidence({
			origin: "https://mail.example.com",
			sessionToken: "session-secret",
			evidence,
			fetchImpl,
		})).resolves.toEqual({ recorded: true, duplicate: false });

		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://mail.example.com/api/admin/operations/evidence",
			expect.objectContaining({
				method: "POST",
				headers: {
					accept: "application/json",
					authorization: "Bearer session-secret",
					"content-type": "application/json",
				},
				body: JSON.stringify({ format: "lumimail-operations-evidence-v1", ...evidence }),
			}),
		);
	});

	it("accepts the exact idempotent replay response", async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
			success: true,
			data: { recorded: true, duplicate: true },
		}), { status: 200 }));

		await expect(publishOperationalEvidence({
			origin: "https://mail.example.com",
			sessionToken: "session-secret",
			evidence,
			fetchImpl,
		})).resolves.toEqual({ recorded: true, duplicate: true });
	});

	it.each([
		"http://mail.example.com",
		"https://user@mail.example.com",
		"https://mail.example.com/path",
		"https://mail.example.com?query=1",
		"https://mail.example.com/#fragment",
	])("rejects a non-exact HTTPS origin without making a request: %s", async (origin) => {
		const fetchImpl = vi.fn();
		await expect(publishOperationalEvidence({ origin, sessionToken: "session-secret", evidence, fetchImpl }))
			.rejects.toBeInstanceOf(OperationalEvidencePublishError);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"",
		" token-with-space",
		"x".repeat(4097),
	])("rejects an absent or unsafe bearer without making a request", async (sessionToken) => {
		const fetchImpl = vi.fn();
		await expect(publishOperationalEvidence({
			origin: "https://mail.example.com", sessionToken, evidence, fetchImpl,
		})).rejects.toBeInstanceOf(OperationalEvidencePublishError);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("accepts a byte-derived recovery archive result of any verified artifact count", async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
			success: true,
			data: { recorded: true, duplicate: false },
		}), { status: 201 }));

		await expect(publishOperationalEvidence({
			origin: "https://mail.example.com",
			sessionToken: "session-secret",
			evidence: { ...evidence, category: "recovery", passedChecks: 16, totalChecks: 16 },
			fetchImpl,
		})).resolves.toEqual({ recorded: true, duplicate: false });
	});

	it.each([
		{ ...evidence, category: "mail_flow" },
		{ ...evidence, category: "recovery", passedChecks: 1001, totalChecks: 1001 },
		{ ...evidence, category: "recovery", totalChecks: 0, passedChecks: 0 },
		{ ...evidence, passedChecks: 6, totalChecks: 6 },
		{ ...evidence, outcome: "failed" },
		{ ...evidence, passedChecks: SMOKE_CHECK_COUNT - 1 },
		{ ...evidence, totalChecks: 0 },
		{ ...evidence, observedAt: "not-a-date" },
		{ ...evidence, extra: "private" },
	])("rejects evidence outside the producer-safe shape", async (invalidEvidence) => {
		const fetchImpl = vi.fn();
		await expect(publishOperationalEvidence({
			origin: "https://mail.example.com", sessionToken: "session-secret",
			evidence: invalidEvidence, fetchImpl,
		})).rejects.toBeInstanceOf(OperationalEvidencePublishError);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		[401, "Unauthorized", "Recording evidence requires a valid owner session."],
		[403, "Forbidden", "Organization owner access is required."],
		[403, "Recent authentication required", "Recent owner authentication is required; sign in again."],
		[400, "Invalid evidence", "The server rejected the derived evidence as invalid."],
		[409, "Evidence already exists with a different result",
			"Evidence already exists for that observation time with a different result."],
		[500, "Evidence could not be recorded", "The server could not record the evidence."],
	])("classifies an exact %s envelope as a fixed operator message", async (status, message, expected) => {
		const fetchImpl = vi.fn(async () => new Response(
			JSON.stringify({ success: false, error: { message } }), { status },
		));

		await expect(publishOperationalEvidence({
			origin: "https://mail.example.com", sessionToken: "session-secret", evidence, fetchImpl,
		})).rejects.toThrow(expected);
	});

	it.each([
		["an unmapped status", 418, { success: false, error: { message: "Unauthorized" } }],
		["unmapped server text", 403, { success: false, error: { message: "leaked internal PRIVATE detail" } }],
		["an unexpected envelope", 403, { success: false, error: { message: "Forbidden" }, extra: "PRIVATE" }],
		["a success flag that is not false", 403, { success: true, error: { message: "Forbidden" } }],
	])("keeps %s generic so server text is never an egress path", async (_label, status, body) => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status }));

		await expect(publishOperationalEvidence({
			origin: "https://mail.example.com", sessionToken: "session-secret", evidence, fetchImpl,
		})).rejects.toThrow("Operational evidence could not be recorded.");
	});

	it.each([
		["an absent token", { sessionToken: undefined }, "No usable owner session token in LUMIMAIL_SESSION_TOKEN."],
		["a non-exact origin", { origin: "https://mail.example.com/path" },
			"The target must be an exact HTTPS origin with no path, query, or credentials."],
		["an unaccepted result shape", { evidence: { ...evidence, category: "mail_flow" } },
			"The derived result did not match the accepted evidence shape."],
	])("names %s before any request is made", async (_label, override, expected) => {
		const fetchImpl = vi.fn();

		await expect(publishOperationalEvidence({
			origin: "https://mail.example.com", sessionToken: "session-secret", evidence, fetchImpl,
			...override,
		})).rejects.toThrow(expected);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		() => Promise.reject(new Error("session-secret PRIVATE network detail")),
		() => Promise.resolve(new Response("session-secret PRIVATE server detail", { status: 403 })),
		() => Promise.resolve(new Response(JSON.stringify({ success: true, data: { recorded: true } }), { status: 201 })),
	])("collapses transport and response failures to one content-free error", async (fetchImpl) => {
		let caught: unknown;
		try {
			await publishOperationalEvidence({
				origin: "https://mail.example.com", sessionToken: "session-secret", evidence, fetchImpl,
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(OperationalEvidencePublishError);
		expect(String(caught)).toContain("Operational evidence could not be recorded.");
		expect(String(caught)).not.toContain("session-secret");
		expect(String(caught)).not.toContain("PRIVATE");
	});
});
