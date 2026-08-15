import { describe, expect, it, vi } from "vitest";

import {
	OperationalEvidencePublishError,
	publishOperationalEvidence,
} from "../../../scripts/operations-evidence.mjs";

const evidence = {
	category: "smoke",
	outcome: "passed",
	passedChecks: 6,
	totalChecks: 6,
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

	it.each([
		{ ...evidence, category: "recovery" },
		{ ...evidence, outcome: "failed" },
		{ ...evidence, passedChecks: 7 },
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
