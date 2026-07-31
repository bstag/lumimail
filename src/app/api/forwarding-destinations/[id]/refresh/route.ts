import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { forwardingDestinations } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { listDestinationAddresses } from "@/lib/cloudflare-api";

export const POST = withOrgAdmin<{ id: string }>(async ({ env, user, params }) => {
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

	let verifiedAt: Date | null = null;
	try {
		const all = await listDestinationAddresses(env);
		const match = all.find((entry) => entry.email.toLowerCase() === destination.address);
		verifiedAt = match?.verified ? new Date(match.verified) : null;
	} catch {
		return apiError("Could not reach Cloudflare to check verification", 502);
	}

	const now = new Date();
	await db
		.update(forwardingDestinations)
		.set({ verifiedAt, lastCheckedAt: now, updatedAt: now })
		.where(and(
			eq(forwardingDestinations.id, id),
			eq(forwardingDestinations.organizationId, organizationId),
		));

	return apiSuccess({ id, address: destination.address, verified: verifiedAt !== null });
});
