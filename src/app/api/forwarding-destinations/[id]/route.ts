import { and, eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { aliases, forwardingDestinations, routingRules } from "@/db/schema";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { apiError, apiSuccess } from "@/lib/api/response";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const organizationId = orgUser.organizationId as string;
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
	// silent-drop defect, so dependents must be cleared first.
	const [dependentRule] = await db
		.select({ id: routingRules.id })
		.from(routingRules)
		.where(and(
			eq(routingRules.organizationId, organizationId),
			eq(routingRules.forwardTo, destination.address),
		))
		.limit(1);
	const [dependentAlias] = await db
		.select({ id: aliases.id })
		.from(aliases)
		.where(and(
			eq(aliases.organizationId, organizationId),
			eq(aliases.forwardTo, destination.address),
		))
		.limit(1);

	if (dependentRule || dependentAlias) {
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
}
