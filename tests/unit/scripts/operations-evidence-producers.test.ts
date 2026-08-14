import { describe, expect, it, vi } from "vitest";

import { runReleaseEvidenceCommand } from "../../../scripts/release-evidence.mjs";
import { runSmokeCommand } from "../../../scripts/smoke.mjs";

const now = () => new Date("2026-08-12T20:00:00.000Z");
const tokenEnvironment = { ...process.env, LUMIMAIL_SESSION_TOKEN: "session-secret" };

function smokeFetch(failedPath?: string) {
	return vi.fn(async (input: Parameters<typeof fetch>[0]) => {
		const path = new URL(String(input)).pathname;
		const anonymous = new Set([
			"/api/auth/me", "/api/mailboxes", "/api/admin/mailboxes",
			"/api/push/config", "/api/push/devices",
		]);
		const expected = anonymous.has(path) ? 401 : 200;
		return new Response(null, { status: path === failedPath ? 500 : expected });
	}) as unknown as typeof fetch;
}

describe("smoke evidence adapter", () => {
	it("does not publish without explicit recording even when a token exists", async () => {
		const publishEvidence = vi.fn();
		await expect(runSmokeCommand(["https://mail.example.com"], {
			fetchImpl: smokeFetch(), publishEvidence, environment: tokenEnvironment,
			stdout: vi.fn(), stderr: vi.fn(), now,
		})).resolves.toBe(0);
		expect(publishEvidence).not.toHaveBeenCalled();
	});

	it("derives a passing eight-check result and publishes only in recording mode", async () => {
		const publishEvidence = vi.fn(async (input: unknown) => {
			void input;
			return { recorded: true as const, duplicate: false };
		});
		await expect(runSmokeCommand(["https://mail.example.com", "--record-evidence"], {
			fetchImpl: smokeFetch(), publishEvidence, environment: tokenEnvironment,
			stdout: vi.fn(), stderr: vi.fn(), now,
		})).resolves.toBe(0);
		expect(publishEvidence).toHaveBeenCalledWith({
			origin: "https://mail.example.com", sessionToken: "session-secret",
			evidence: { category: "smoke", outcome: "passed", passedChecks: 8, totalChecks: 8,
				observedAt: "2026-08-12T20:00:00.000Z" },
		});
	});

	it("accepts the npm recording alias flag before the target origin", async () => {
		const publishEvidence = vi.fn(async (input: unknown) => {
			void input;
			return { recorded: true as const, duplicate: false };
		});
		await expect(runSmokeCommand(["--record-evidence", "https://mail.example.com"], {
			fetchImpl: smokeFetch(), publishEvidence, environment: tokenEnvironment,
			stdout: vi.fn(), stderr: vi.fn(), now,
		})).resolves.toBe(0);
		expect(publishEvidence).toHaveBeenCalledOnce();
	});

	it("records the derived failed count and preserves a failed smoke exit", async () => {
		const publishEvidence = vi.fn(async (input: unknown) => {
			void input;
			return { recorded: true as const, duplicate: false };
		});
		await expect(runSmokeCommand(["https://mail.example.com", "--record-evidence"], {
			fetchImpl: smokeFetch("/api/mailboxes"), publishEvidence, environment: tokenEnvironment,
			stdout: vi.fn(), stderr: vi.fn(), now,
		})).resolves.toBe(1);
		expect(publishEvidence).toHaveBeenCalledWith(expect.objectContaining({ evidence: {
			category: "smoke", outcome: "failed", passedChecks: 7, totalChecks: 8,
			observedAt: "2026-08-12T20:00:00.000Z",
		} }));
	});

	it("fails closed with bounded output when publication fails", async () => {
		const stderr = vi.fn();
		await expect(runSmokeCommand(["https://mail.example.com", "--record-evidence"], {
			fetchImpl: smokeFetch(),
			publishEvidence: vi.fn(async (input: unknown) => {
				void input;
				throw new Error("session-secret PRIVATE");
			}),
			environment: tokenEnvironment, stdout: vi.fn(), stderr, now,
		})).resolves.toBe(1);
		expect(stderr).toHaveBeenCalledWith("Operational evidence could not be recorded.");
		expect(JSON.stringify(stderr.mock.calls)).not.toContain("session-secret");
		expect(JSON.stringify(stderr.mock.calls)).not.toContain("PRIVATE");
	});
});

describe("signed-release evidence adapter", () => {
	const args = ["bundle", "signature", "trust", "1.2.3", "0032", "https://mail.example.com"];

	it("verifies first, then publishes the fixed passing result", async () => {
		const verifyRelease = vi.fn(() => ({ verified: true }));
		const publishEvidence = vi.fn(async (input: unknown) => {
			void input;
			return { recorded: true as const, duplicate: false };
		});
		await expect(runReleaseEvidenceCommand(args, {
			verifyRelease, publishEvidence, environment: tokenEnvironment,
			stdout: vi.fn(), stderr: vi.fn(), now,
		})).resolves.toBe(0);
		expect(verifyRelease).toHaveBeenCalledWith({ bundleDirectory: "bundle", signaturePath: "signature",
			trustPath: "trust", expectedVersion: "1.2.3", expectedSchema: "0032" });
		expect(publishEvidence).toHaveBeenCalledWith({
			origin: "https://mail.example.com", sessionToken: "session-secret",
			evidence: { category: "release", outcome: "passed", passedChecks: 1, totalChecks: 1,
				observedAt: "2026-08-12T20:00:00.000Z" },
		});
	});

	it("publishes nothing when verification or arguments fail", async () => {
		for (const commandArgs of [args.slice(0, 5), args]) {
			const publishEvidence = vi.fn();
			const stderr = vi.fn();
			await expect(runReleaseEvidenceCommand(commandArgs, {
				verifyRelease: vi.fn(() => { throw new Error("PRIVATE release detail"); }),
				publishEvidence, environment: tokenEnvironment, stdout: vi.fn(), stderr, now,
			})).resolves.toBe(1);
			expect(publishEvidence).not.toHaveBeenCalled();
			expect(stderr).toHaveBeenCalledWith("Release verification failed. Release is not trusted.");
		}
	});

	it("fails closed with bounded output when publication fails", async () => {
		const stderr = vi.fn();
		await expect(runReleaseEvidenceCommand(args, {
			verifyRelease: vi.fn(() => ({ verified: true })),
			publishEvidence: vi.fn(async (input: unknown) => {
				void input;
				throw new Error("session-secret PRIVATE");
			}),
			environment: tokenEnvironment, stdout: vi.fn(), stderr, now,
		})).resolves.toBe(1);
		expect(stderr).toHaveBeenCalledWith("Operational evidence could not be recorded.");
		expect(JSON.stringify(stderr.mock.calls)).not.toContain("session-secret");
	});
});
