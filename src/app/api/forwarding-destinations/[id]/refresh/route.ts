import { and, eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { forwardingDestinations } from "@/db/schema";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { apiError, apiSuccess } from "@/lib/api/response";
import { listDestinationAddresses } from "@/lib/cloudflare-api";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
	const { id } = await params;
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;

	const db = getDb(env);
	const organizationId = orgUser.organizationId;
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
}
