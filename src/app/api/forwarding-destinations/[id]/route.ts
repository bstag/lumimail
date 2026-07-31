import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { forwardingDestinations, routingRules } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";

export const DELETE = withOrgAdmin<{ id: string }>(async ({ env, user, params }) => {
	const { id } = params;
	const db = getDb(env);
	const organizationId = user.organizationId;
	const [destination] = await db
		.select({ id: forwardingDestinations.id, address: forwardingDestinations.address })
		.from(forwardingDestinations)
		.where(and(
			eq(forwardingDestinations.id, id),
			eq(forwardingDestinations.organizationId, organizationId),
		))
		.limit(1);

	if (!destination) return apiError("Destination not found", 404);

	// Removing ownership while a rule still points at the address would recreate the
	// silent-drop defect, so dependents must be cleared first. Only routing rules can
	// reference a destination: the app never writes a non-null aliases.forwardTo
	// (aliases are created with forwardTo: null and never updated), so no alias
	// dependency check is needed.
	const [dependentRule] = await db
		.select({ id: routingRules.id })
		.from(routingRules)
		.where(and(
			eq(routingRules.organizationId, organizationId),
			eq(routingRules.forwardTo, destination.address),
		))
		.limit(1);

	if (dependentRule) {
		return apiError("Remove the rules forwarding to this destination first", 409);
	}

	await db
		.delete(forwardingDestinations)
		.where(and(
			eq(forwardingDestinations.id, id),
			eq(forwardingDestinations.organizationId, organizationId),
		));

	// The account-level Cloudflare address is intentionally left in place: it may be
	// registered by another organization on the same account.
	return apiSuccess({ id });
});
