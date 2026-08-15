const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const RESOURCE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const PLACEHOLDER_PATTERN = /^(?:ACCOUNT_ID|BUCKET_NAME|D1_ID|QUEUE_NAME|STAGING_[A-Z0-9_]+|WORKER_NAME|YOUR_[A-Z0-9_]+|CHANGE_ME|REPLACE_ME|TODO|TBD|<[^>]+>)$/i;

export class RecoveryTargetError extends Error {
	constructor(problems) {
		const copiedProblems = Object.freeze([...problems]);
		const noun = copiedProblems.length === 1 ? "problem" : "problems";
		super(
			`Recovery target is unsafe (${copiedProblems.length} ${noun}). No changes were made.`,
		);
		this.name = "RecoveryTargetError";
		this.code = "UNSAFE_RECOVERY_TARGET";
		this.problems = copiedProblems;
	}
}

function isResolvedName(value) {
	return (
		typeof value === "string" &&
		value === value.trim() &&
		RESOURCE_NAME_PATTERN.test(value) &&
		!PLACEHOLDER_PATTERN.test(value)
	);
}

function isObservedCount(value) {
	return Number.isInteger(value) && value >= 0;
}

function deepFreeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) {
			deepFreeze(nested);
		}
		Object.freeze(value);
	}
	return value;
}

export function assertSafeRecoveryTarget({ production, target }) {
	const problems = [];
	const productionAccountIdValid = ACCOUNT_ID_PATTERN.test(
		production?.accountId ?? "",
	);
	const productionWorkerNameValid = isResolvedName(production?.workerName);
	const productionD1IdValid = UUID_PATTERN.test(production?.d1?.id ?? "");
	const productionR2BucketValid = isResolvedName(production?.r2?.bucketName);

	if (!productionAccountIdValid) {
		problems.push(
			"production.accountId must be a resolved Cloudflare account ID",
		);
	}
	if (!productionWorkerNameValid) {
		problems.push("production.workerName must be a resolved Worker name");
	}
	if (!productionD1IdValid) {
		problems.push("production.d1.id must be a resolved D1 UUID");
	}
	if (!productionR2BucketValid) {
		problems.push(
			"production.r2.bucketName must be a resolved R2 bucket name",
		);
	}
	if (!Array.isArray(production?.queueNames)) {
		problems.push("production.queueNames must be an observed array");
	} else {
		for (const [index, queueName] of production.queueNames.entries()) {
			if (!isResolvedName(queueName)) {
				problems.push(
					`production.queueNames[${index}] must be a resolved Queue name`,
				);
			}
		}
	}

	const accountIdValid = ACCOUNT_ID_PATTERN.test(target?.accountId ?? "");
	const workerNameValid = isResolvedName(target?.workerName);
	const d1IdValid = UUID_PATTERN.test(target?.d1?.id ?? "");
	const d1NameValid = isResolvedName(target?.d1?.name);
	const r2BucketValid = isResolvedName(target?.r2?.bucketName);

	if (!accountIdValid) {
		problems.push("target.accountId must be a resolved Cloudflare account ID");
	}
	if (!workerNameValid) {
		problems.push("target.workerName must be a resolved Worker name");
	}
	if (!d1IdValid) {
		problems.push("target.d1.id must be a resolved D1 UUID");
	}
	if (!d1NameValid) {
		problems.push("target.d1.name must be a resolved D1 name");
	}
	if (!r2BucketValid) {
		problems.push("target.r2.bucketName must be a resolved R2 bucket name");
	}

	const productionAccountId = production?.accountId?.toLowerCase();
	if (
		accountIdValid &&
		productionAccountIdValid &&
		target.accountId.toLowerCase() !== productionAccountId
	) {
		problems.push("target.accountId does not match the expected production account");
	}
	if (
		workerNameValid &&
		productionWorkerNameValid &&
		target.workerName === production.workerName
	) {
		problems.push("target.workerName overlaps the production Worker");
	}
	if (
		d1IdValid &&
		productionD1IdValid &&
		target.d1.id.toLowerCase() === production.d1.id.toLowerCase()
	) {
		problems.push("target.d1.id overlaps the production D1 database");
	}
	if (
		r2BucketValid &&
		productionR2BucketValid &&
		target.r2.bucketName === production.r2.bucketName
	) {
		problems.push("target.r2.bucketName overlaps the production R2 bucket");
	}

	if (!isObservedCount(target?.d1?.userTableCount)) {
		problems.push(
			"target.d1.userTableCount must be an observed non-negative integer",
		);
	} else if (target.d1.userTableCount > 0) {
		problems.push(
			`target.d1 must contain zero user tables; observed ${target.d1.userTableCount}`,
		);
	}
	if (!isObservedCount(target?.r2?.objectCount)) {
		problems.push(
			"target.r2.objectCount must be an observed non-negative integer",
		);
	} else if (target.r2.objectCount > 0) {
		problems.push(
			`target.r2 must contain zero objects; observed ${target.r2.objectCount}`,
		);
	}

	const seenQueueNames = new Set();
	const productionQueueNames = new Set(
		Array.isArray(production?.queueNames) ? production.queueNames : [],
	);
	if (!Array.isArray(target?.queueNames)) {
		problems.push("target.queueNames must be an observed array");
	} else {
		for (const [index, queueName] of target.queueNames.entries()) {
			if (!isResolvedName(queueName)) {
				problems.push(`target.queueNames[${index}] must be a resolved Queue name`);
				continue;
			}
			if (seenQueueNames.has(queueName)) {
				problems.push(
					`target.queueNames[${index}] duplicates another target Queue`,
				);
			} else if (productionQueueNames.has(queueName)) {
				problems.push(`target.queueNames[${index}] overlaps a production Queue`);
			}
			seenQueueNames.add(queueName);
		}
	}

	if (!Array.isArray(target?.emailRoutes)) {
		problems.push("target.emailRoutes must be an observed array");
	} else {
		let receivesEmail = false;
		for (const [index, route] of target.emailRoutes.entries()) {
			if (typeof route?.enabled !== "boolean") {
				problems.push(
					`target.emailRoutes[${index}].enabled must be an observed boolean`,
				);
			}
			if (!isResolvedName(route?.destinationWorker)) {
				problems.push(
					`target.emailRoutes[${index}].destinationWorker must be a resolved Worker name`,
				);
			}
			if (
				workerNameValid &&
				route?.enabled === true &&
				route.destinationWorker === target.workerName
			) {
				receivesEmail = true;
			}
		}
		if (receivesEmail) {
			problems.push(
				"target.workerName receives email from an enabled Email Routing rule",
			);
		}
	}

	if (problems.length > 0) {
		throw new RecoveryTargetError(problems);
	}

	return deepFreeze({
		accountId: target.accountId.toLowerCase(),
		workerName: target.workerName,
		d1: {
			id: target.d1.id.toLowerCase(),
			name: target.d1.name,
			userTableCount: target.d1.userTableCount,
		},
		r2: {
			bucketName: target.r2.bucketName,
			objectCount: target.r2.objectCount,
		},
		queueNames: [...target.queueNames],
		emailRoutes: target.emailRoutes.map((route) => ({ ...route })),
	});
}
