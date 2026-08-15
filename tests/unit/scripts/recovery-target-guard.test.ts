import { describe, expect, it } from "vitest";

import {
	RecoveryTargetError,
	assertSafeRecoveryTarget,
} from "../../../scripts/recovery-target-guard.mjs";

const production = {
	accountId: "caddde404ba5d0324c315dc5cf143696",
	workerName: "lumimail",
	d1: {
		id: "ffe4de32-cf15-4f56-96b5-e14dc8031b42",
		name: "lumimail-prod",
	},
	r2: { bucketName: "lumimail-raw-prod" },
	queueNames: [
		"lumimail-inbound-prod",
		"lumimail-outbound-prod",
		"lumimail-outbound-dlq-prod",
	],
};

function safeTarget() {
	return {
		accountId: production.accountId.toUpperCase(),
		workerName: "lumimail-recovery-20260812",
		d1: {
			id: "11111111-2222-4333-8444-555555555555".toUpperCase(),
			name: "lumimail-recovery-20260812",
			userTableCount: 0,
		},
		r2: {
			bucketName: "lumimail-recovery-20260812",
			objectCount: 0,
		},
		queueNames: ["lumimail-recovery-inbound-20260812"],
		emailRoutes: [
			{ enabled: false, destinationWorker: "lumimail-recovery-20260812" },
			{ enabled: true, destinationWorker: "some-other-worker" },
		],
	};
}

function problemsFor(target: ReturnType<typeof safeTarget>): string[] {
	try {
		assertSafeRecoveryTarget({ production, target });
		throw new Error("expected target to be rejected");
	} catch (error) {
		expect(error).toBeInstanceOf(RecoveryTargetError);
		return (error as InstanceType<typeof RecoveryTargetError>).problems as string[];
	}
}

describe("assertSafeRecoveryTarget", () => {
	it("returns a normalized frozen identity for an empty, unrouted, non-production target", () => {
		const target = safeTarget();
		const original = structuredClone(target);

		const result = assertSafeRecoveryTarget({ production, target });

		expect(result).toEqual({
			...target,
			accountId: production.accountId,
			d1: {
				...target.d1,
				id: target.d1.id.toLowerCase(),
			},
		});
		expect(target).toEqual(original);
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.d1)).toBe(true);
		expect(Object.isFrozen(result.r2)).toBe(true);
		expect(Object.isFrozen(result.queueNames)).toBe(true);
		expect(Object.isFrozen(result.emailRoutes)).toBe(true);
		expect(Object.isFrozen(result.emailRoutes[0])).toBe(true);
	});

	it("aggregates missing, placeholder, and malformed required identities", () => {
		const target = safeTarget();
		Object.assign(target, {
			accountId: "ACCOUNT_ID",
			workerName: "STAGING_WORKER_NAME",
			d1: { id: "STAGING_D1_ID", name: "", userTableCount: 0 },
			r2: { bucketName: "YOUR_BUCKET_NAME", objectCount: 0 },
		});

		expect(problemsFor(target)).toEqual([
			"target.accountId must be a resolved Cloudflare account ID",
			"target.workerName must be a resolved Worker name",
			"target.d1.id must be a resolved D1 UUID",
			"target.d1.name must be a resolved D1 name",
			"target.r2.bucketName must be a resolved R2 bucket name",
		]);
	});

	it("fails closed when production identity inventory is unresolved", () => {
		const invalidProduction = {
			accountId: "ACCOUNT_ID",
			workerName: "WORKER_NAME",
			d1: { id: "D1_ID", name: "unused" },
			r2: { bucketName: "BUCKET_NAME" },
			queueNames: ["QUEUE_NAME"],
		};

		expect(() =>
			assertSafeRecoveryTarget({
				production: invalidProduction,
				target: safeTarget(),
			}),
		).toThrowError(
			expect.objectContaining({
				problems: [
					"production.accountId must be a resolved Cloudflare account ID",
					"production.workerName must be a resolved Worker name",
					"production.d1.id must be a resolved D1 UUID",
					"production.r2.bucketName must be a resolved R2 bucket name",
					"production.queueNames[0] must be a resolved Queue name",
				],
			}),
		);
	});

	it("rejects every overlap with production resources", () => {
		const target = safeTarget();
		target.workerName = production.workerName;
		target.d1.id = production.d1.id.toUpperCase();
		target.r2.bucketName = production.r2.bucketName;

		expect(problemsFor(target)).toEqual([
			"target.workerName overlaps the production Worker",
			"target.d1.id overlaps the production D1 database",
			"target.r2.bucketName overlaps the production R2 bucket",
		]);
	});

	it("requires the explicitly expected same Cloudflare account", () => {
		const target = safeTarget();
		target.accountId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

		expect(problemsFor(target)).toEqual([
			"target.accountId does not match the expected production account",
		]);
	});

	it("rejects populated stores and unobserved counts", () => {
		const target = safeTarget();
		target.d1.userTableCount = 3;
		target.r2.objectCount = 9;

		expect(problemsFor(target)).toEqual([
			"target.d1 must contain zero user tables; observed 3",
			"target.r2 must contain zero objects; observed 9",
		]);

		const invalidCounts = safeTarget() as unknown as {
			d1: { userTableCount: unknown };
			r2: { objectCount: unknown };
		};
		invalidCounts.d1.userTableCount = "0";
		invalidCounts.r2.objectCount = -1;
		expect(problemsFor(invalidCounts as ReturnType<typeof safeTarget>)).toEqual([
			"target.d1.userTableCount must be an observed non-negative integer",
			"target.r2.objectCount must be an observed non-negative integer",
		]);
	});

	it("rejects only enabled Email Routing rules targeting the recovery Worker", () => {
		const target = safeTarget();
		target.emailRoutes.push({
			enabled: true,
			destinationWorker: target.workerName,
		});

		expect(problemsFor(target)).toEqual([
			"target.workerName receives email from an enabled Email Routing rule",
		]);
	});

	it("fails closed when Queue or Email Routing observations are malformed", () => {
		const target = safeTarget() as unknown as {
			queueNames: unknown;
			emailRoutes: unknown;
		};
		target.queueNames = "not-observed";
		target.emailRoutes = "not-observed";

		expect(problemsFor(target as ReturnType<typeof safeTarget>)).toEqual([
			"target.queueNames must be an observed array",
			"target.emailRoutes must be an observed array",
		]);

		const malformedRoutes = safeTarget();
		malformedRoutes.emailRoutes = [
			{ enabled: true, destinationWorker: "WORKER_NAME" },
			{ enabled: "false", destinationWorker: "some-other-worker" },
		] as unknown as ReturnType<typeof safeTarget>["emailRoutes"];
		expect(problemsFor(malformedRoutes)).toEqual([
			"target.emailRoutes[0].destinationWorker must be a resolved Worker name",
			"target.emailRoutes[1].enabled must be an observed boolean",
		]);
	});

	it("rejects duplicate, placeholder, and production Queue names", () => {
		const target = safeTarget();
		target.queueNames = [
			"lumimail-recovery-inbound-20260812",
			"lumimail-recovery-inbound-20260812",
			"QUEUE_NAME",
			production.queueNames[1],
		];

		expect(problemsFor(target)).toEqual([
			"target.queueNames[1] duplicates another target Queue",
			"target.queueNames[2] must be a resolved Queue name",
			"target.queueNames[3] overlaps a production Queue",
		]);
	});

	it("throws an immutable structured error without caller-owned problem state", () => {
		const target = safeTarget();
		target.r2.objectCount = 1;

		try {
			assertSafeRecoveryTarget({ production, target });
			throw new Error("expected target to be rejected");
		} catch (error) {
			expect(error).toBeInstanceOf(RecoveryTargetError);
			const recoveryError = error as InstanceType<typeof RecoveryTargetError>;
			expect(recoveryError.code).toBe("UNSAFE_RECOVERY_TARGET");
			expect(recoveryError.message).toBe("Recovery target is unsafe (1 problem). No changes were made.");
			expect(recoveryError.problems).toEqual([
				"target.r2 must contain zero objects; observed 1",
			]);
			expect(Object.isFrozen(recoveryError.problems)).toBe(true);
			expect(() =>
				(recoveryError.problems as string[]).push("caller mutation"),
			).toThrow();
		}
	});
});
