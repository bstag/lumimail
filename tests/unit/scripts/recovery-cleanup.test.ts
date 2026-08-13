import { describe, expect, it, vi } from "vitest";

import { runRecoveryCleanup } from "../../../scripts/recovery-cleanup.mjs";

const currentVersionId = "34571aef-6642-4ea5-bc42-85eebb730e16";
const target = {
	accountId: "caddde404ba5d0324c315dc5cf143696",
	workerName: "lumimail-recovery-20260812",
	configPath: "wrangler.recovery.jsonc",
	origin: "https://lumimail-recovery-20260812.blackstag.workers.dev",
	d1: { id: "d239de97-37f1-4b9a-a664-f787ea60aa97", name: "lumimail-staging" },
	r2: { bucketName: "lumimail-raw-staging" },
};
const production = {
	workerName: "lumimail",
	d1: { id: "ffe4de32-cf15-4f56-96b5-e14dc8031b42", name: "lumimail-prod" },
	r2: { bucketName: "lumimail-raw-prod" },
	queueNames: ["lumimail-inbound-prod", "lumimail-outbound-prod", "lumimail-outbound-dlq-prod"],
};

function config() {
	return {
		name: target.workerName,
		account_id: target.accountId,
		workers_dev: true,
		routes: [],
		vars: { PUBLIC_APP_URL: target.origin, R2_SWEEP_ENABLED: "false", SEED_ENABLED: "false" },
		d1_databases: [{ binding: "DB", database_name: target.d1.name, database_id: target.d1.id }],
		r2_buckets: [{ binding: "BUCKET", bucket_name: target.r2.bucketName }],
	};
}

function evidence() {
	return {
		manifest: {
			source: {
				accountId: target.accountId,
				worker: { name: production.workerName },
				d1: production.d1,
				r2: production.r2,
			},
			objects: [
				{ key: "attachments/u1/m1/a1" },
				{ key: "inbound/message-1.eml" },
			],
		},
	};
}

function runner(options?: {
	bucketDeleteFails?: boolean;
	changedFingerprint?: boolean;
	workerStatusError?: Error & { stderr?: string };
}) {
	let workerExists = !options?.workerStatusError;
	let d1Exists = true;
	let bucketExists = true;
	const runWrangler = vi.fn((args: string[]) => {
		const command = args.slice(0, 3).join(" ");
		if (command === "deployments status --config") {
			if (!workerExists) throw options?.workerStatusError ?? Object.assign(new Error("Worker absent"), { code: "WORKER_NOT_FOUND" });
			return JSON.stringify({ versions: [{ version_id: currentVersionId, percentage: 100 }] });
		}
		if (command === "d1 list --config") {
			return JSON.stringify([
				{ uuid: production.d1.id, name: production.d1.name },
				...(d1Exists ? [{ uuid: target.d1.id, name: target.d1.name }] : []),
			]);
		}
		if (command === "r2 bucket info") {
			if (!bucketExists) throw Object.assign(new Error("Bucket absent"), { code: "BUCKET_NOT_FOUND" });
			return JSON.stringify({ name: target.r2.bucketName, object_count: "2" });
		}
		if (args[0] === "email" && args[1] === "routing" && args[2] === "list") return "";
		if (args[0] === "delete") {
			workerExists = false;
			return "";
		}
		if (args[0] === "r2" && args[1] === "object" && args[2] === "delete") return "";
		if (args[0] === "r2" && args[1] === "bucket" && args[2] === "delete") {
			if (options?.bucketDeleteFails) throw new Error("Bucket was not empty");
			bucketExists = false;
			return "";
		}
		if (args[0] === "d1" && args[1] === "delete") {
			d1Exists = false;
			return "";
		}
		if (args[0] === "r2" && args[1] === "bucket" && args[2] === "list") {
			return bucketExists ? `${target.r2.bucketName}\n${production.r2.bucketName}` : production.r2.bucketName;
		}
		throw new Error(`Unexpected command: ${args.join(" ")}`);
	});
	let fingerprintRead = 0;
	const readProductionFingerprint = vi.fn(() => {
		fingerprintRead += 1;
		return {
			workerVersions: [{
				versionId: options?.changedFingerprint && fingerprintRead === 2 ? "changed" : "stable",
				percentage: 100,
			}],
			d1: production.d1,
			r2: { name: production.r2.bucketName, created: "created", location: "WNAM", storageClass: "Standard" },
			queueNames: [...production.queueNames].sort(),
			routingSha256: "a".repeat(64),
		};
	});
	return { runWrangler, readProductionFingerprint };
}

function inputs(overrides: Record<string, unknown> = {}) {
	const mocks = runner();
	return {
		backupDirectory: "private/recovery",
		currentVersionId,
		production,
		recoveryConfig: config(),
		target,
		loadEvidence: vi.fn(() => evidence()),
		runSmoke: vi.fn(() => ({ passed: 6, total: 6 })),
		...mocks,
		...overrides,
	};
}

describe("runRecoveryCleanup", () => {
	it("deletes only exact recovery resources in exposure-first order and proves absence", () => {
		const args = inputs();
		expect(runRecoveryCleanup(args)).toEqual({
			deletedObjectCount: 2,
			d1Id: target.d1.id,
			productionFingerprintUnchanged: true,
			r2BucketName: target.r2.bucketName,
			workerDeleted: true,
			workerName: target.workerName,
		});

		const mutations = args.runWrangler.mock.calls
			.map(([command]) => command)
			.filter((command) => command[0] === "delete" ||
				(command[0] === "r2" && command[2] === "delete") ||
				(command[0] === "d1" && command[1] === "delete"));
		expect(mutations).toEqual([
			["delete", target.workerName, "--config", target.configPath],
			["r2", "object", "delete", `${target.r2.bucketName}/attachments/u1/m1/a1`, "--config", target.configPath, "--remote", "--force"],
			["r2", "object", "delete", `${target.r2.bucketName}/inbound/message-1.eml`, "--config", target.configPath, "--remote", "--force"],
			["r2", "bucket", "delete", target.r2.bucketName, "--config", target.configPath],
			["d1", "delete", target.d1.name, "--config", target.configPath, "--skip-confirmation"],
		]);
		expect(args.loadEvidence).toHaveBeenCalledWith("private/recovery");
	});

	it("resumes at R2 when the exact recovery Worker is already absent", () => {
		const statusError = Object.assign(new Error("bounded provider failure"), {
			stderr: "Cloudflare API request failed [code: 10007]",
		});
		const args = inputs(runner({ workerStatusError: statusError }));
		expect(runRecoveryCleanup(args)).toEqual({
			deletedObjectCount: 2,
			d1Id: target.d1.id,
			productionFingerprintUnchanged: true,
			r2BucketName: target.r2.bucketName,
			workerDeleted: false,
			workerName: target.workerName,
		});
		expect(args.runSmoke).not.toHaveBeenCalled();
		expect(args.runWrangler.mock.calls.some(([command]) => command[0] === "delete")).toBe(false);
	});

	it("does not reinterpret unclassified Worker status failures as absence", () => {
		const statusError = Object.assign(new Error("Worker not found"), { stderr: "PRIVATE" });
		const args = inputs(runner({ workerStatusError: statusError }));
		expect(() => runRecoveryCleanup(args)).toThrow("Worker not found");
		expect(args.runSmoke).not.toHaveBeenCalled();
		expect(args.runWrangler.mock.calls.some(([command]) => command[0] === "delete" ||
			(command[0] === "r2" && command[2] === "delete") ||
			(command[0] === "d1" && command[1] === "delete"))).toBe(false);
	});

	it.each([
		["wrong config", { recoveryConfig: { ...config(), name: production.workerName } }],
		["failed smoke", { runSmoke: vi.fn(() => ({ passed: 5, total: 6 })) }],
		["production overlap", { target: { ...target, d1: production.d1 } }],
	])("refuses %s before mutation", (_label, override) => {
		const args = inputs(override);
		expect(() => runRecoveryCleanup(args)).toThrow(/precondition|input/i);
		expect(args.runWrangler.mock.calls.some(([command]) => command[0] === "delete")).toBe(false);
	});

	it("stops before D1 deletion when the exact-object cleanup cannot empty the bucket", () => {
		const mocks = runner({ bucketDeleteFails: true });
		const args = inputs(mocks);
		expect(() => runRecoveryCleanup(args)).toThrow("Bucket was not empty");
		expect(args.runWrangler.mock.calls.some(([command]) => command[0] === "d1" && command[1] === "delete")).toBe(false);
	});

	it("fails the gate when production inventory changes during cleanup", () => {
		const mocks = runner({ changedFingerprint: true });
		expect(() => runRecoveryCleanup(inputs(mocks))).toThrow(/production.*changed/i);
	});
});
