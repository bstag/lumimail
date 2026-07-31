import { withOrgAdmin } from "@/lib/api/handler";
import { addDomainSchema } from "@/lib/validators";
import {
	addDomainForUser,
	DomainAlreadyRegisteredError,
	getDomainDns,
	listUserDomains,
} from "@/lib/domains/service";
import { summariseDns, type DnsStatusSummary } from "@/lib/dns-status";
import { apiSuccess, apiError } from "@/lib/api/response";

export const GET = withOrgAdmin(async ({ request, env, user }) => {
	const domains = await listUserDomains(env, user.organizationId);

	const includeDns = new URL(request.url).searchParams.get("includeDns") === "true";

	const dns: Record<string, DnsStatusSummary> = {};
	if (includeDns) {
		const results = await Promise.allSettled(
			domains.map(async (domain) => {
				const view = await getDomainDns(env, domain);
				return {
					id: domain.id,
					summary: summariseDns(view.routing.records, view.routing.missing, view.sending),
				};
			}),
		);
		for (const r of results) {
			if (r.status === "fulfilled") {
				dns[r.value.id] = r.value.summary;
			}
		}
	}

	return apiSuccess({ domains, dns: includeDns ? dns : undefined });
});

export const POST = withOrgAdmin(async ({ request, env, user }) => {
	const parsed = addDomainSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	try {
		const result = await addDomainForUser(env, user.id, user.organizationId, parsed.data.hostname, {
			enableRouting: parsed.data.enableRouting,
			enableSending: parsed.data.enableSending,
		});
		return apiSuccess(result);
	} catch (error) {
		// Expected conflict: the hostname belongs to another organization (T-38).
		if (error instanceof DomainAlreadyRegisteredError) {
			return apiError(error.message, 409);
		}
		return apiError("Failed to add domain", 400);
	}
});
