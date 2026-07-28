import { getEnv } from "@/lib/cloudflare";
import { provisionDomainOnCloudflare } from "@/lib/domains/provision";
import { getPrimaryDomain } from "@/lib/user";
import { setupDomainSchema } from "@/lib/validators";
import { apiSuccess, apiError } from "@/lib/api/response";

export async function POST(request: Request) {
	const env = getEnv();
	const existing = await getPrimaryDomain(env);
	if (existing) return apiError("Primary domain already exists", 409);

	const parsed = setupDomainSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	try {
		const provisioned = await provisionDomainOnCloudflare(env, parsed.data.hostname, {
			enableRouting: true,
			enableSending: true,
		});
		return apiSuccess({ domain: {
			hostname: provisioned.hostname,
			zoneId: provisioned.zone.id,
			routingEnabled: provisioned.routingEnabled,
			sendingEnabled: provisioned.sendingEnabled,
		}});
	} catch {
		return apiError("Domain setup failed", 502);
	}
}
