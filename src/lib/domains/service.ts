import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { newId } from "@/lib/ids";
import {
	disableEmailRouting,
	getEmailRoutingDns,
	getEmailRoutingSettings,
	getSendingSubdomainDns,
	ensureSendingDomain,
	findSendingDomain,
	type CfDnsRecord,
} from "@/lib/cloudflare-api";
import { deleteEmailRoutingRulesForDomain } from "@/lib/domains/cloudflare-cleanup";
import { provisionDomainOnCloudflare } from "@/lib/domains/provision";

export type DomainDnsView = {
	routing: { records: CfDnsRecord[]; missing: CfDnsRecord[]; status?: string };
	sending: { enabled: boolean; records: CfDnsRecord[] };
};

export async function listUserDomains(env: CloudflareEnv, organizationId: string) {
	const db = getDb(env);
	return db.select().from(domains).where(eq(domains.organizationId, organizationId));
}

export async function addDomainForUser(
	env: CloudflareEnv,
	userId: string,
	organizationId: string,
	hostname: string,
	options?: { enableRouting?: boolean; enableSending?: boolean },
): Promise<{ domain: typeof domains.$inferSelect; dns: DomainDnsView }> {
	const provisioned = await provisionDomainOnCloudflare(env, hostname, options);

	const db = getDb(env);
	const [existing] = await db.select().from(domains).where(eq(domains.hostname, provisioned.hostname)).limit(1);
	if (existing && existing.organizationId !== organizationId) {
		throw new Error("Domain is already registered");
	}

	const domainId = existing?.id ?? newId("dom");
	const values = {
		id: domainId,
		userId,
		organizationId,
		hostname: provisioned.hostname,
		zoneId: provisioned.zone.id,
		status: provisioned.routingEnabled || provisioned.sendingEnabled ? ("active" as const) : ("pending" as const),
		routingStatus: provisioned.routingStatus ?? null,
		sendingSubdomainTag: provisioned.sendingSubdomainTag,
		sendingEnabled: provisioned.sendingEnabled,
		routingEnabled: provisioned.routingEnabled,
	};

	if (existing) {
		await db.update(domains).set(values).where(eq(domains.id, domainId));
	} else {
		await db.insert(domains).values(values);
	}

	const [domain] = await db.select().from(domains).where(eq(domains.id, domainId)).limit(1);
	const dns = await getDomainDns(env, domain!);
	return { domain: domain!, dns };
}

export async function getDomainDns(
	env: CloudflareEnv,
	domain: typeof domains.$inferSelect,
): Promise<DomainDnsView> {
	const routingDns = await getEmailRoutingDns(env, domain.zoneId);
	const routingSettings = await getEmailRoutingSettings(env, domain.zoneId);
	let sendingRecords: CfDnsRecord[] = [];
	if (domain.sendingSubdomainTag) {
		sendingRecords = await getSendingSubdomainDns(env, domain.zoneId, domain.sendingSubdomainTag);
	}
	return {
		routing: {
			records: routingDns.records,
			missing: routingDns.missing,
			status: routingSettings.status,
		},
		sending: { enabled: domain.sendingEnabled, records: sendingRecords },
	};
}

export async function reconcileDomainSending(
	env: CloudflareEnv,
	domain: typeof domains.$inferSelect,
	action: "verify" | "enable",
): Promise<{ domain: typeof domains.$inferSelect; dns: DomainDnsView }> {
	if (!domain.organizationId) throw new Error("Domain organization is required");
	const sendingDomain =
		action === "enable"
			? await ensureSendingDomain(env, domain.zoneId, domain.hostname)
			: await findSendingDomain(env, domain.zoneId, domain.hostname);
	const sendingEnabled = sendingDomain?.enabled ?? false;
	const updated = {
		...domain,
		sendingEnabled,
		sendingSubdomainTag: sendingDomain?.tag ?? null,
		status: domain.routingEnabled || sendingEnabled ? ("active" as const) : ("pending" as const),
	};

	const db = getDb(env);
	await db
		.update(domains)
		.set({
			sendingEnabled: updated.sendingEnabled,
			sendingSubdomainTag: updated.sendingSubdomainTag,
			status: updated.status,
		})
		.where(and(eq(domains.id, domain.id), eq(domains.organizationId, domain.organizationId)));

	return { domain: updated, dns: await getDomainDns(env, updated) };
}

export async function removeDomainForUser(
	env: CloudflareEnv,
	organizationId: string,
	domainId: string,
): Promise<void> {
	const db = getDb(env);
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(eq(domains.id, domainId), eq(domains.organizationId, organizationId)))
		.limit(1);
	if (!domain) throw new Error("Domain not found");

	try {
		await deleteEmailRoutingRulesForDomain(env, domain.zoneId, domain.hostname);
	} catch (err) {
		console.warn("deleteEmailRoutingRulesForDomain", err);
	}

	if (domain.routingEnabled) {
		try {
			await disableEmailRouting(env, domain.zoneId);
		} catch (err) {
			console.warn("disableEmailRouting", err);
		}
	}

	await db.delete(domains).where(eq(domains.id, domainId));
}

export async function getDomainForUser(env: CloudflareEnv, organizationId: string, domainId: string) {
	const db = getDb(env);
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(eq(domains.id, domainId), eq(domains.organizationId, organizationId)))
		.limit(1);
	return domain ?? null;
}
