import { getEnv } from "@/lib/cloudflare";
import { requireDomainZone } from "@/lib/domains/provision";
import { getPrimaryDomain, hasAnyUser } from "@/lib/user";
import { setupDomainSchema } from "@/lib/validators";
import { apiSuccess, apiError } from "@/lib/api/response";

/**
 * First-boot only, deliberately unauthenticated: the register page calls this
 * before the first account can exist. It fails closed on either bootstrap
 * marker — a primary domain (normal case) or any user (so deleting every
 * domain later does not reopen the preview). Registration owns provisioning.
 */
export async function POST(request: Request) {
	const env = getEnv();
	const existing = await getPrimaryDomain(env);
	if (existing) return apiError("Primary domain already exists", 409);
	if (await hasAnyUser(env)) return apiError("Setup is complete", 403);

	const parsed = setupDomainSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	try {
		const hostname = parsed.data.hostname.toLowerCase().trim();
		await requireDomainZone(env, hostname);
		return apiSuccess({ domain: { hostname } });
	} catch {
		return apiError("Domain setup failed", 502);
	}
}
