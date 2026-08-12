import { describe, expect, it, vi } from "vitest";

import { runRecoveryRollback } from "../../../scripts/recovery-rollback.mjs";

const current = "34571aef-6642-4ea5-bc42-85eebb730e16";
const previous = "7e9f2f79-a2f9-43d8-bbf8-430c0a7bcee1";
const origin = "https://lumimail-recovery-20260812.blackstag.workers.dev";

function deployment(versionId: string, percentage = 100) {
	return JSON.stringify({ versions: [{ version_id: versionId, percentage }] });
}

function runner(options?: { initial?: string; percentage?: number; omitPrevious?: boolean }) {
	let active = options?.initial ?? current;
	return vi.fn((args: string[]) => {
		if (args[0] === "deployments" && args[1] === "status") {
			return deployment(active, options?.percentage ?? 100);
		}
		if (args[0] === "versions" && args[1] === "list") {
			return JSON.stringify([{ id: current }, ...(options?.omitPrevious ? [] : [{ id: previous }])]);
		}
		if (args[0] === "versions" && args[1] === "deploy") {
			active = args[2].split("@")[0];
			return "";
		}
		throw new Error(`Unexpected command ${args.join(" ")}`);
	});
}

describe("runRecoveryRollback", () => {
	it("rolls back, smokes, returns current, and smokes again", () => {
		const runWrangler = runner();
		const runSmoke = vi.fn(() => ({ passed: 6, total: 6 }));
		expect(
			runRecoveryRollback({
				configPath: "wrangler.recovery.jsonc",
				origin,
				currentVersionId: current,
				previousVersionId: previous,
				runWrangler,
				runSmoke,
			}),
		).toEqual({
			currentVersionId: current,
			finalVersionId: current,
			previousVersionId: previous,
			returnSmokePassed: 6,
			rollbackSmokePassed: 6,
		});

		const deploys = runWrangler.mock.calls
			.map(([args]) => args)
			.filter((args) => args[0] === "versions" && args[1] === "deploy");
		expect(deploys).toEqual([
			[
				"versions", "deploy", `${previous}@100`, "--config", "wrangler.recovery.jsonc",
				"--yes", "--message", "Lumimail recovery rollback drill",
			],
			[
				"versions", "deploy", `${current}@100`, "--config", "wrangler.recovery.jsonc",
				"--yes", "--message", "Lumimail recovery rollback return",
			],
		]);
		expect(runSmoke).toHaveBeenNthCalledWith(1, origin);
		expect(runSmoke).toHaveBeenNthCalledWith(2, origin);
	});

	it.each([
		["wrong active version", { initial: previous }],
		["split traffic", { percentage: 50 }],
		["missing previous version", { omitPrevious: true }],
	])("refuses %s before deployment", (_label, options) => {
		const runWrangler = runner(options);
		expect(() =>
			runRecoveryRollback({
				configPath: "wrangler.recovery.jsonc",
				origin,
				currentVersionId: current,
				previousVersionId: previous,
				runWrangler,
				runSmoke: vi.fn(),
			}),
		).toThrow("rollback precondition");
		expect(
			runWrangler.mock.calls.some(([args]) => args[0] === "versions" && args[1] === "deploy"),
		).toBe(false);
	});

	it("returns the intended version even when rollback smoke fails", () => {
		const runWrangler = runner();
		const runSmoke = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error("smoke failed");
			})
			.mockReturnValueOnce({ passed: 6, total: 6 });
		expect(() =>
			runRecoveryRollback({
				configPath: "wrangler.recovery.jsonc",
				origin,
				currentVersionId: current,
				previousVersionId: previous,
				runWrangler,
				runSmoke,
			}),
		).toThrow("smoke failed");
		expect(runWrangler.mock.calls.at(-1)?.[0][0]).toBe("deployments");
		expect(runSmoke).toHaveBeenCalledTimes(2);
	});

	it("rejects production config, duplicate IDs, and non-HTTPS origins", () => {
		for (const invalid of [
			{ configPath: "wrangler.jsonc", origin, currentVersionId: current, previousVersionId: previous },
			{ configPath: "wrangler.recovery.jsonc", origin, currentVersionId: current, previousVersionId: current },
			{ configPath: "wrangler.recovery.jsonc", origin: "http://recovery.example", currentVersionId: current, previousVersionId: previous },
		]) {
			const runWrangler = runner();
			expect(() =>
				runRecoveryRollback({ ...invalid, runWrangler, runSmoke: vi.fn() }),
			).toThrow("rollback input");
			expect(runWrangler).not.toHaveBeenCalled();
		}
	});
});
