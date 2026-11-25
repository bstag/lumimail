import { enableEmailRouting, ensureSendingDomain, findZoneByHostname } from "@/lib/cloudflare-api";
import { isZoneApex } from "@/lib/domains/utils";
import type { DomainProvisioningResult } from "@/lib/domains/types";
import { isInstanceOperator } from "@/lib/auth/instance-operator";
import { z } from "zod";

const domainAllowlist = z.record(z.string(), z.array(z.string()));

export function canProvisionDomain(env: CloudflareEnv, userId: string, organizationId: string, hostname: string): boolean {
	if (isInstanceOperator(env, userId)) return true;
	try {
		const allowlist = domainAllowlist.parse(JSON.parse(env.DOMAIN_PROVISIONING_ALLOWLIST ?? "{}"));
		return Object.hasOwn(allowlist, organizationId) && allowlist[organizationId].includes(hostname.toLowerCase().trim());
	} catch {
		return false;
	}
}

export async function requireDomainZone(env: CloudflareEnv, hostname: string) {
	const zone = await findZoneByHostname(env, hostname);
	if (!zone) {
		throw new Error(
			`Zone not found for "${hostname}". The domain must use Cloudflare DNS on this account.`,
		);
	}
	return zone;
}

export async function provisionDomainOnCloudflare(
	env: CloudflareEnv,
	hostname: string,
	options?: { enableRouting?: boolean; enableSending?: boolean },
	resolvedZone?: DomainProvisioningResult["zone"],
): Promise<DomainProvisioningResult> {
	const normalized = hostname.toLowerCase().trim();
	const zone = resolvedZone ?? await requireDomainZone(env, normalized);

	const enableRouting = options?.enableRouting ?? true;
	const enableSending = options?.enableSending ?? true;

	let routingEnabled = false;
	let sendingEnabled = false;
	let sendingSubdomainTag: string | null = null;
	let routingStatus: string | undefined;

	if (enableRouting) {
		const routingName = isZoneApex(normalized, zone.name) ? undefined : normalized;
		const routing = await enableEmailRouting(env, zone.id, routingName);
		routingEnabled = routing.enabled ?? true;
		routingStatus = routing.status;
	}

	if (enableSending) {
		const sendingDomain = await ensureSendingDomain(env, zone.id, normalized);
		sendingSubdomainTag = sendingDomain.tag;
		sendingEnabled = sendingDomain.enabled;
	}

	return {
		hostname: normalized,
		zone,
		routingEnabled,
		sendingEnabled,
		sendingSubdomainTag,
		routingStatus,
	};
}
