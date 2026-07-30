import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { domains, forwardingDestinations } from "@/db/schema";
import { parseAddress } from "@/lib/utils";
import type { RoutingDecision } from "@/lib/email/routing";

export type ForwardRefusalReason =
	| "invalid_address"
	| "managed_domain"
	| "not_owned"
	| "not_verified";

export type ForwardAuthorization =
	| { allowed: true; address: string }
	| { allowed: false; reason: ForwardRefusalReason };

/**
 * Deliberately NOT delegated to `normalizeEmailAddress` (address.ts): that
 * helper extracts the bare address from display-name forms ("Name <a@b>"),
 * while destination handling normalizes and stores the caller's full string —
 * the forwarding-destinations route feeds raw request input through here, and
 * extracting would silently loosen what it accepts and stores.
 */
export function normalizeDestinationAddress(address: string): string {
	return address.trim().toLowerCase();
}

/**
 * Decides whether an organization may forward to an external address.
 *
 * Two independent conditions must both hold. Cloudflare destination addresses are
 * account-level and shared by every tenant on the account, so Cloudflare's own
 * verification is necessary but never sufficient — without the organization-scoped
 * ownership row, one organization could forward to an address another organization
 * verified. Destinations inside a Lumimail-managed domain are refused outright
 * because they would route straight back into this Worker.
 */
export async function authorizeForwardDestination(
	db: AppDatabase,
	organizationId: string | null,
	address: string,
): Promise<ForwardAuthorization> {
	const normalized = normalizeDestinationAddress(address);
	const parsed = parseAddress(normalized);
	if (!parsed) return { allowed: false, reason: "invalid_address" };
	if (!organizationId) return { allowed: false, reason: "not_owned" };

	const [managed] = await db
		.select({ id: domains.id })
		.from(domains)
		.where(eq(domains.hostname, parsed.domain))
		.limit(1);
	if (managed) return { allowed: false, reason: "managed_domain" };

	const [owned] = await db
		.select({
			id: forwardingDestinations.id,
			address: forwardingDestinations.address,
			verifiedAt: forwardingDestinations.verifiedAt,
		})
		.from(forwardingDestinations)
		.where(and(
			eq(forwardingDestinations.organizationId, organizationId),
			eq(forwardingDestinations.address, normalized),
		))
		.limit(1);

	if (!owned) return { allowed: false, reason: "not_owned" };
	if (!owned.verifiedAt) return { allowed: false, reason: "not_verified" };

	return { allowed: true, address: normalized };
}

export type ForwardTargetSelection = {
	allowed: string[];
	refused: { address: string; reason: ForwardRefusalReason }[];
};

/**
 * Reduces routing decisions to the destinations this message may actually be
 * forwarded to. Refusals are returned rather than thrown so the caller can record
 * them without losing the delivery decisions that did succeed.
 */
export async function selectForwardTargets(
	db: AppDatabase,
	decisions: RoutingDecision[],
): Promise<ForwardTargetSelection> {
	const allowed: string[] = [];
	const refused: { address: string; reason: ForwardRefusalReason }[] = [];
	const seen = new Set<string>();

	for (const decision of decisions) {
		if (decision.action !== "forward" || !decision.forwardTo) continue;

		const normalized = normalizeDestinationAddress(decision.forwardTo);
		if (seen.has(normalized)) continue;
		seen.add(normalized);

		const authorization = await authorizeForwardDestination(
			db,
			decision.organizationId ?? null,
			normalized,
		);
		if (authorization.allowed) {
			allowed.push(authorization.address);
		} else {
			refused.push({ address: normalized, reason: authorization.reason });
		}
	}

	return { allowed, refused };
}

/**
 * The subset of `ForwardableEmailMessage` forwarding needs. Declaring it
 * structurally keeps this logic testable outside the Workers runtime.
 */
export type ForwardCapableMessage = {
	// The Workers runtime resolves this to an EmailSendResult; the return value is
	// not part of what forwarding needs, so it stays deliberately opaque here.
	forward: (rcptTo: string, headers?: Headers) => Promise<unknown>;
};

export type InboundForwardResult = {
	forwarded: string[];
	refused: { address: string; reason: ForwardRefusalReason }[];
	failed: string[];
};

/**
 * Forwards an inbound message to every authorized destination.
 *
 * Each destination is attempted independently so one bad address cannot suppress
 * delivery to the others. Failures are returned rather than thrown; the caller
 * decides whether the message can still be accepted, because that depends on
 * whether any mailbox is also storing it.
 */
export async function forwardInbound(
	db: AppDatabase,
	message: ForwardCapableMessage,
	decisions: RoutingDecision[],
): Promise<InboundForwardResult> {
	const { allowed, refused } = await selectForwardTargets(db, decisions);
	const forwarded: string[] = [];
	const failed: string[] = [];

	for (const address of allowed) {
		try {
			await message.forward(address);
			forwarded.push(address);
		} catch {
			failed.push(address);
		}
	}

	return { forwarded, refused, failed };
}

/**
 * True when forwarding was configured but nothing was delivered and no mailbox is
 * storing the message. Accepting it would silently discard mail, which is the exact
 * defect F62 exists to remove, so the caller must reject and let the sending server
 * retry instead.
 */
export function shouldRejectUndeliverable(
	decisions: RoutingDecision[],
	result: InboundForwardResult,
): boolean {
	const forwardRequested = decisions.some(
		(decision) => decision.action === "forward" && decision.forwardTo,
	);
	if (!forwardRequested) return false;
	if (result.forwarded.length > 0) return false;

	return !decisions.some((decision) => decision.action === "store" && decision.mailbox);
}
