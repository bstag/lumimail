import { and, eq, ne } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { domains, mailboxes, routingRules } from "@/db/schema";
import { normalizeRoutingPattern } from "@/lib/email/routing-pattern";
import {
	disableEmailRoutingCatchAllToWorker,
	ensureEmailRoutingCatchAllToWorker,
} from "@/lib/cloudflare-api";
import {
	authorizeForwardDestination,
	type ForwardRefusalReason,
} from "@/lib/email/forwarding";

/**
 * Shared service for the routing-rule routes (T-40), modeled on
 * `src/lib/domains/service.ts`: the catch-all detection/provisioning dance and
 * its Cloudflare error mapping live here as typed results, and the routes map
 * them onto their exact response bodies and statuses.
 */

type DomainRow = typeof domains.$inferSelect;

/** Load a domain scoped to the caller's organization (cross-tenant safe). */
export async function getOrgDomain(
	db: AppDatabase,
	organizationId: string,
	domainId: string,
): Promise<DomainRow | null> {
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(eq(domains.id, domainId), eq(domains.organizationId, organizationId)))
		.limit(1);
	return domain ?? null;
}

/**
 * A `store` rule may only target a mailbox on the rule's own domain within the
 * caller's organization.
 */
export async function storeTargetMailboxExists(
	db: AppDatabase,
	organizationId: string,
	domainId: string,
	mailboxId: string,
): Promise<boolean> {
	const [mailbox] = await db
		.select({ id: mailboxes.id })
		.from(mailboxes)
		.where(and(
			eq(mailboxes.id, mailboxId),
			eq(mailboxes.domainId, domainId),
			eq(mailboxes.organizationId, organizationId),
		))
		.limit(1);
	return !!mailbox;
}

/**
 * True when the domain already has a rule that normalizes to the `*` catch-all
 * (any spelling), optionally ignoring one rule id (the rule being edited).
 */
export async function domainHasCatchAllRule(
	db: AppDatabase,
	domain: Pick<DomainRow, "id" | "hostname">,
	excludeRuleId?: string,
): Promise<boolean> {
	const rows = await db
		.select({ id: routingRules.id, pattern: routingRules.pattern })
		.from(routingRules)
		.where(and(
			eq(routingRules.domainId, domain.id),
			...(excludeRuleId ? [ne(routingRules.id, excludeRuleId)] : []),
		));
	return rows.some((row) => {
		const normalized = normalizeRoutingPattern(row.pattern, domain.hostname);
		return normalized.ok && normalized.pattern === "*";
	});
}

/**
 * True when any other rule in the same Cloudflare zone (across the org's
 * domains sharing that zone) still normalizes to a catch-all — the provider
 * catch-all is zone-level, so it must stay enabled until the last one goes.
 */
export async function hasOtherCatchAllInZone(
	db: AppDatabase,
	organizationId: string,
	zoneId: string,
	excludedRuleId: string,
): Promise<boolean> {
	const rows = await db
		.select({ pattern: routingRules.pattern, hostname: domains.hostname })
		.from(routingRules)
		.innerJoin(domains, eq(domains.id, routingRules.domainId))
		.where(and(
			eq(domains.organizationId, organizationId),
			eq(domains.zoneId, zoneId),
			ne(routingRules.id, excludedRuleId),
		));
	return rows.some((row) => {
		const normalized = normalizeRoutingPattern(row.pattern, row.hostname);
		return normalized.ok && normalized.pattern === "*";
	});
}

export type CatchAllSyncResult =
	| { ok: true }
	| { ok: false; error: "conflict" | "provider" };

/**
 * Reconcile the zone-level Cloudflare catch-all with a rule transition:
 * becoming a catch-all provisions delivery to the Worker; ceasing to be the
 * zone's last catch-all disables it. Provider failures are mapped to typed
 * results — `conflict` when Cloudflare's catch-all is already claimed by
 * another destination, `provider` for anything else — so no raw Cloudflare
 * error detail reaches a response body.
 */
export async function syncCatchAllTransition(
	env: CloudflareEnv,
	db: AppDatabase,
	args: {
		organizationId: string;
		domain: Pick<DomainRow, "zoneId">;
		/** Rule being edited/deleted; required to release the zone catch-all. */
		ruleId?: string;
		wasCatchAll: boolean;
		isCatchAll: boolean;
	},
): Promise<CatchAllSyncResult> {
	try {
		if (args.isCatchAll) {
			await ensureEmailRoutingCatchAllToWorker(env, args.domain.zoneId);
		} else if (
			args.wasCatchAll &&
			args.ruleId &&
			!(await hasOtherCatchAllInZone(db, args.organizationId, args.domain.zoneId, args.ruleId))
		) {
			await disableEmailRoutingCatchAllToWorker(env, args.domain.zoneId);
		}
		return { ok: true };
	} catch (error) {
		if (error instanceof Error && error.name === "CloudflareCatchAllConflictError") {
			return { ok: false, error: "conflict" };
		}
		return { ok: false, error: "provider" };
	}
}

export type ForwardAuthorizationResult =
	| { allowed: true }
	| { allowed: false; message: string };

/**
 * Fail closed on forward destinations: a rule pointing at an unowned or
 * unverified destination would silently discard every matching message (F62),
 * so refusals come back with the user-facing message already chosen.
 */
export async function authorizeForwardTarget(
	db: AppDatabase,
	organizationId: string,
	forwardTo: string,
): Promise<ForwardAuthorizationResult> {
	const authorization = await authorizeForwardDestination(db, organizationId, forwardTo);
	if (authorization.allowed) return { allowed: true };
	return { allowed: false, message: forwardRefusalMessage(authorization.reason) };
}

export function forwardRefusalMessage(reason: ForwardRefusalReason): string {
	switch (reason) {
		case "invalid_address":
			return "A valid forwarding destination is required";
		case "managed_domain":
			return "Cannot forward to an address on a domain Lumimail manages";
		case "not_verified":
			return "That destination has not confirmed Cloudflare's verification email yet";
		default:
			return "Register this forwarding destination before using it";
	}
}
