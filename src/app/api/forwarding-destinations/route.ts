import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, forwardingDestinations } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { newId } from "@/lib/ids";
import { parseAddress } from "@/lib/utils";
import { normalizeDestinationAddress } from "@/lib/email/forwarding";
import {
	createDestinationAddress,
	listDestinationAddresses,
} from "@/lib/cloudflare-api";

export const GET = withOrgAdmin(async ({ env, user: orgUser }) => {
	const db = getDb(env);
	const rows = await db
		.select({
			id: forwardingDestinations.id,
			address: forwardingDestinations.address,
			verifiedAt: forwardingDestinations.verifiedAt,
			lastCheckedAt: forwardingDestinations.lastCheckedAt,
			createdAt: forwardingDestinations.createdAt,
		})
		.from(forwardingDestinations)
		.where(eq(forwardingDestinations.organizationId, orgUser.organizationId));

	return apiSuccess(
		rows.map((row) => ({ ...row, verified: row.verifiedAt !== null })),
	);
});

export const POST = withOrgAdmin(async ({ request, env, user: orgUser }) => {
	const body = (await request.json().catch(() => null)) as { address?: unknown } | null;
	const rawAddress = typeof body?.address === "string" ? body.address : "";
	const address = normalizeDestinationAddress(rawAddress);
	const parsed = parseAddress(address);
	if (!parsed) return apiError("A valid destination address is required", 400);

	const db = getDb(env);

	// A destination inside a managed domain would route back into this Worker.
	const [managed] = await db
		.select({ id: domains.id })
		.from(domains)
		.where(eq(domains.hostname, parsed.domain))
		.limit(1);
	if (managed) {
		return apiError("Cannot forward to an address on a domain Picket manages", 422);
	}

	const organizationId = orgUser.organizationId;
	const [existing] = await db
		.select({ id: forwardingDestinations.id })
		.from(forwardingDestinations)
		.where(and(
			eq(forwardingDestinations.organizationId, organizationId),
			eq(forwardingDestinations.address, address),
		))
		.limit(1);
	if (existing) return apiError("That destination is already registered", 409);

	// Ask Cloudflare first. If this fails there must be no ownership row implying a
	// verification email was sent.
	let verifiedAt: Date | null = null;
	try {
		const created = await createDestinationAddress(env, address);
		verifiedAt = created.verified ? new Date(created.verified) : null;
	} catch {
		// The address may already exist account-wide from another organization or an
		// earlier registration; adopt its current state rather than failing outright.
		try {
			const all = await listDestinationAddresses(env);
			const match = all.find((entry) => entry.email.toLowerCase() === address);
			if (!match) return apiError("Cloudflare rejected the destination address", 502);
			verifiedAt = match.verified ? new Date(match.verified) : null;
		} catch {
			return apiError("Cloudflare rejected the destination address", 502);
		}
	}

	const now = new Date();
	const id = newId("fwd");
	await db.insert(forwardingDestinations).values({
		id,
		organizationId,
		address,
		verifiedAt,
		lastCheckedAt: now,
		createdAt: now,
		updatedAt: now,
	});

	return apiSuccess({ id, address, verified: verifiedAt !== null }, 201);
});
