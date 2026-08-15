import { describe, expect, it, vi } from "vitest";

import {
	OBSERVATION_CLOCK_SKEW_MS,
	OperationalEvidencePublishError,
	SMOKE_CHECK_COUNT,
} from "../../../scripts/operations-evidence.mjs";
import { runRecoveryEvidenceCommand } from "../../../scripts/recovery-evidence.mjs";
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

	it("keeps the published total equal to the boundary-owned expected count", async () => {
		const publishEvidence = vi.fn(async (input: unknown) => {
			void input;
			return { recorded: true as const, duplicate: false };
		});
		await runSmokeCommand(["https://mail.example.com", "--record-evidence"], {
			fetchImpl: smokeFetch(), publishEvidence, environment: tokenEnvironment,
			stdout: vi.fn(), stderr: vi.fn(), now,
		});
		expect(publishEvidence).toHaveBeenCalledWith(expect.objectContaining({
			evidence: expect.objectContaining({ totalChecks: SMOKE_CHECK_COUNT }),
		}));
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
				observedAt: "2026-08-12T19:59:55.000Z" },
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
			observedAt: "2026-08-12T19:59:55.000Z",
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
				observedAt: "2026-08-12T19:59:55.000Z" },
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

describe("recovery archive evidence adapter", () => {
	const args = ["/backups/2026-08-12", "https://mail.example.com"];

	function publisher() {
		return vi.fn(async (input: unknown) => {
			void input;
			return { recorded: true as const, duplicate: false };
		});
	}

	it("derives the passing artifact count from the verified archive", async () => {
		const verifyArchive = vi.fn(() => ({ checkedDatabase: 1, checkedObjects: 15, problems: [] }));
		const publishEvidence = publisher();

		await expect(runRecoveryEvidenceCommand(args, {
			verifyArchive, publishEvidence, environment: tokenEnvironment,
			stdout: vi.fn(), stderr: vi.fn(), now,
		})).resolves.toBe(0);

		expect(verifyArchive).toHaveBeenCalledWith("/backups/2026-08-12");
		expect(publishEvidence).toHaveBeenCalledWith({
			origin: "https://mail.example.com", sessionToken: "session-secret",
			evidence: { category: "recovery", outcome: "passed", passedChecks: 16, totalChecks: 16,
				observedAt: "2026-08-12T19:59:55.000Z" },
		});
	});

	it("counts each failing artifact once and records a truthful failed result", async () => {
		const publishEvidence = publisher();

		await expect(runRecoveryEvidenceCommand(args, {
			verifyArchive: vi.fn(() => ({
				checkedDatabase: 1,
				checkedObjects: 3,
				problems: [
					"attachments/a.bin: size 10 != 12",
					"attachments/a.bin: checksum mismatch",
					"attachments/b.bin: file missing from backup",
				],
			})),
			publishEvidence, environment: tokenEnvironment, stdout: vi.fn(), stderr: vi.fn(), now,
		})).resolves.toBe(1);

		expect(publishEvidence).toHaveBeenCalledWith(expect.objectContaining({
			evidence: { category: "recovery", outcome: "failed", passedChecks: 2, totalChecks: 4,
				observedAt: "2026-08-12T19:59:55.000Z" },
		}));
	});

	it("never lets a derived failure count reach or exceed the verified total", async () => {
		const publishEvidence = publisher();

		await expect(runRecoveryEvidenceCommand(args, {
			verifyArchive: vi.fn(() => ({
				checkedDatabase: 1,
				checkedObjects: 0,
				problems: ["db/export.sql: checksum mismatch", "objects/ghost.bin: unexpected"],
			})),
			publishEvidence, environment: tokenEnvironment, stdout: vi.fn(), stderr: vi.fn(), now,
		})).resolves.toBe(1);

		expect(publishEvidence).toHaveBeenCalledWith(expect.objectContaining({
			evidence: expect.objectContaining({ outcome: "failed", passedChecks: 0, totalChecks: 1 }),
		}));
	});

	it.each([
		["an unreadable or foreign manifest", () => { throw new Error("PRIVATE /backups path detail"); }],
		["a malformed verification result", () => ({ checkedDatabase: "1", problems: [] })],
		["a missing problem list", () => ({ checkedDatabase: 1, checkedObjects: 2 })],
		["an artifact count above the ledger bound", () => ({ checkedDatabase: 1, checkedObjects: 1000, problems: [] })],
	])("publishes nothing for %s", async (_label, verifyArchive) => {
		const publishEvidence = vi.fn();
		const stderr = vi.fn();

		await expect(runRecoveryEvidenceCommand(args, {
			verifyArchive: vi.fn(verifyArchive as () => never), publishEvidence,
			environment: tokenEnvironment, stdout: vi.fn(), stderr, now,
		})).resolves.toBe(1);

		expect(publishEvidence).not.toHaveBeenCalled();
		expect(stderr).toHaveBeenCalledWith("Recovery archive verification failed. Evidence was not recorded.");
		expect(JSON.stringify(stderr.mock.calls)).not.toContain("PRIVATE");
		expect(JSON.stringify(stderr.mock.calls)).not.toContain("/backups");
	});

	it.each([
		["no arguments", []],
		["a missing origin", ["/backups/2026-08-12"]],
		["extra arguments", [...args, "--force-pass"]],
		["an empty directory", ["", "https://mail.example.com"]],
	])("refuses %s before verifying anything", async (_label, commandArgs) => {
		const verifyArchive = vi.fn();
		const publishEvidence = vi.fn();

		await expect(runRecoveryEvidenceCommand(commandArgs, {
			verifyArchive, publishEvidence, environment: tokenEnvironment,
			stdout: vi.fn(), stderr: vi.fn(), now,
		})).resolves.toBe(1);

		expect(verifyArchive).not.toHaveBeenCalled();
		expect(publishEvidence).not.toHaveBeenCalled();
	});

	it("fails closed with bounded output when publication fails", async () => {
		const stderr = vi.fn();

		await expect(runRecoveryEvidenceCommand(args, {
			verifyArchive: vi.fn(() => ({ checkedDatabase: 1, checkedObjects: 15, problems: [] })),
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

describe("producer failure reporting", () => {
	// One opaque message left an operator unable to tell an absent token from an
	// immutable-history conflict. Every producer must surface the publisher's class.
	const classified = "Recent owner authentication is required; sign in again.";

	function failing(error: Error) {
		return (async (input: unknown) => {
			void input;
			throw error;
		}) as Publisher;
	}

	type Publisher = Parameters<typeof runRecoveryEvidenceCommand>[1] extends { publishEvidence?: infer P } ? P : never;
	const producers: Array<[string, (publish: Publisher, stderr: () => void) => Promise<number>]> = [
		["recovery", (publishEvidence, stderr) => runRecoveryEvidenceCommand(
			["/backups/2026-08-12", "https://mail.example.com"],
			{
				verifyArchive: vi.fn(() => ({ checkedDatabase: 1, checkedObjects: 2, problems: [] })),
				publishEvidence, environment: tokenEnvironment, stdout: vi.fn(), stderr, now,
			},
		)],
		["signed release", (publishEvidence, stderr) => runReleaseEvidenceCommand(
			["bundle", "signature", "trust", "1.2.3", "0032", "https://mail.example.com"],
			{
				verifyRelease: vi.fn(() => ({ verified: true })),
				publishEvidence, environment: tokenEnvironment, stdout: vi.fn(), stderr, now,
			},
		)],
		["public smoke", (publishEvidence, stderr) => runSmokeCommand(
			["https://mail.example.com", "--record-evidence"],
			{
				fetchImpl: smokeFetch(), publishEvidence, environment: tokenEnvironment,
				stdout: vi.fn(), stderr, now,
			},
		)],
	];

	it.each(producers)("surfaces the classified publisher message from the %s producer", async (_label, run) => {
		const stderr = vi.fn();

		await expect(run(failing(new OperationalEvidencePublishError(classified)), stderr)).resolves.toBe(1);

		expect(stderr).toHaveBeenCalledWith(classified);
	});

	it.each(producers)("keeps an unclassified %s failure generic", async (_label, run) => {
		const stderr = vi.fn();

		await expect(run(failing(new Error("session-secret PRIVATE")), stderr)).resolves.toBe(1);

		expect(stderr).toHaveBeenCalledWith("Operational evidence could not be recorded.");
		expect(JSON.stringify(stderr.mock.calls)).not.toContain("session-secret");
		expect(JSON.stringify(stderr.mock.calls)).not.toContain("PRIVATE");
	});
});

describe("observation timestamps", () => {
	// The ledger refuses an observation later than the edge clock, so a workstation
	// running fractionally ahead would have every result rejected as invalid.
	it.each([
		["recovery", (publishEvidence: never, stderr: () => void) => runRecoveryEvidenceCommand(
			["/backups/2026-08-12", "https://mail.example.com"],
			{
				verifyArchive: vi.fn(() => ({ checkedDatabase: 1, checkedObjects: 2, problems: [] })),
				publishEvidence, environment: tokenEnvironment, stdout: vi.fn(), stderr, now,
			},
		)],
		["signed release", (publishEvidence: never, stderr: () => void) => runReleaseEvidenceCommand(
			["bundle", "signature", "trust", "1.2.3", "0032", "https://mail.example.com"],
			{
				verifyRelease: vi.fn(() => ({ verified: true })),
				publishEvidence, environment: tokenEnvironment, stdout: vi.fn(), stderr, now,
			},
		)],
		["public smoke", (publishEvidence: never, stderr: () => void) => runSmokeCommand(
			["https://mail.example.com", "--record-evidence"],
			{
				fetchImpl: smokeFetch(), publishEvidence, environment: tokenEnvironment,
				stdout: vi.fn(), stderr, now,
			},
		)],
	])("stamps the %s result behind the local clock by the shared offset", async (_label, run) => {
		const publishEvidence = vi.fn(async (input: unknown) => {
			void input;
			return { recorded: true as const, duplicate: false };
		});

		await run(publishEvidence as never, vi.fn());

		const [[published]] = publishEvidence.mock.calls as unknown as [[{ evidence: { observedAt: string } }]];
		const { observedAt } = published.evidence;
		expect(Date.parse(observedAt)).toBe(now().getTime() - OBSERVATION_CLOCK_SKEW_MS);
	});
});
