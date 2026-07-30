import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { addDomainSchema } from "@/lib/validators";
import { addDomainForUser, getDomainDns, listUserDomains } from "@/lib/domains/service";
import { summariseDns, type DnsStatusSummary } from "@/lib/dns-status";
import { apiSuccess, apiError } from "@/lib/api/response";

export async function GET(request: NextRequest) {
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;
	const domains = await listUserDomains(env, orgUser.organizationId);

	const includeDns = request.nextUrl.searchParams.get("includeDns") === "true";

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

	return NextResponse.json({ domains, dns: includeDns ? dns : undefined });
}

export async function POST(request: Request) {
	const env = getEnv();
	const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
	if (errorResponse) return errorResponse;
	const parsed = addDomainSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	try {
		const result = await addDomainForUser(env, orgUser.id, orgUser.organizationId, parsed.data.hostname, {
			enableRouting: parsed.data.enableRouting,
			enableSending: parsed.data.enableSending,
		});
		return apiSuccess(result);
	} catch {
		return apiError("Failed to add domain", 400);
	}
}
