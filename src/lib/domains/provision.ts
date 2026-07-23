import { enableEmailRouting, ensureSendingDomain, findZoneByHostname } from "@/lib/cloudflare-api";
import { isZoneApex } from "@/lib/domains/utils";
import type { DomainProvisioningResult } from "@/lib/domains/types";

export async function provisionDomainOnCloudflare(
	env: CloudflareEnv,
	hostname: string,
	options?: { enableRouting?: boolean; enableSending?: boolean },
): Promise<DomainProvisioningResult> {
	const normalized = hostname.toLowerCase().trim();
	const zone = await findZoneByHostname(env, normalized);
	if (!zone) {
		throw new Error(
			`Zone not found for "${normalized}". The domain must use Cloudflare DNS on this account.`,
		);
	}

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
