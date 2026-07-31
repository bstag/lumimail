import { eq, and, desc } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { aliases, domains, groupMembers, mailboxes, routingRules } from "@/db/schema";
import { parseAddress } from "@/lib/utils";
import { expandAliasTargets } from "@/lib/email/alias-targets";

export type ResolvedMailbox = {
	mailboxId: string;
	userId: string;
	organizationId: string | null;
	domainId: string;
	localPart: string;
	hostname: string;
	displayName: string | null;
};

export type RoutingDecision = {
	action: "store" | "forward" | "reject";
	mailbox?: ResolvedMailbox;
	forwardTo?: string;
	/**
	 * Owning organization of a forward decision. Cloudflare destination addresses
	 * are account-level, so forwarding must be authorized against the organization
	 * that registered the destination rather than against verification alone.
	 */
	organizationId?: string | null;
};

type RoutingRule = typeof routingRules.$inferSelect;
type ActiveDomain = typeof domains.$inferSelect;
type Alias = typeof aliases.$inferSelect;
type ParsedInboundAddress = { local: string; domain: string };

async function loadActiveDomain(
	db: AppDatabase,
	hostname: string,
): Promise<ActiveDomain | null> {
	const [domain] = await db
		.select()
		.from(domains)
		.where(and(eq(domains.hostname, hostname), eq(domains.status, "active")))
		.limit(1);
	return domain ?? null;
}

async function loadMailboxDecision(
	db: AppDatabase,
	mailboxId: string,
	organizationId: string | null,
	fallbackDomainId: string,
	fallbackHostname: string,
): Promise<RoutingDecision | null> {
	const [mailbox] = await db
		.select({
			id: mailboxes.id,
			userId: mailboxes.userId,
			organizationId: mailboxes.organizationId,
			domainId: mailboxes.domainId,
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			hostname: domains.hostname,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.where(and(
			eq(mailboxes.id, mailboxId),
			...(organizationId ? [eq(mailboxes.organizationId, organizationId)] : []),
		))
		.limit(1);
	if (!mailbox) return null;
	return {
		action: "store",
		mailbox: {
			mailboxId: mailbox.id,
			userId: mailbox.userId,
			organizationId: mailbox.organizationId,
			domainId: mailbox.domainId ?? fallbackDomainId,
			localPart: mailbox.localPart,
			hostname: mailbox.hostname ?? fallbackHostname,
			displayName: mailbox.displayName,
		},
	};
}

async function resolveRuleDecision(
	db: AppDatabase,
	rule: RoutingRule,
	domainId: string,
	hostname: string,
): Promise<RoutingDecision | null> {
	if (rule.action === "reject") return { action: "reject" };
	if (rule.action === "forward") {
		return rule.forwardTo
			? { action: "forward", forwardTo: rule.forwardTo, organizationId: rule.organizationId }
			: null;
	}
	return rule.mailboxId
		? loadMailboxDecision(db, rule.mailboxId, rule.organizationId, domainId, hostname)
		: null;
}

/**
 * Resolve a group alias's membership rows into explicit store decisions (rows
 * whose `groupMembers.mailboxId` joined an organization mailbox) plus the
 * legacy/external members still expanded by {@link expandAliasTargets}.
 */
async function resolveGroupMembers(
	db: AppDatabase,
	alias: Alias,
	domain: ActiveDomain,
): Promise<{
	explicitDecisions: RoutingDecision[];
	members: { mailboxId: string | null; email: string | null }[];
}> {
	const explicitDecisions: RoutingDecision[] = [];
	const members: { mailboxId: string | null; email: string | null }[] = [];
	const rows = await db
		.select({
			memberMailboxId: groupMembers.mailboxId,
			legacyUserId: groupMembers.userId,
			email: groupMembers.email,
			mailboxId: mailboxes.id,
			userId: mailboxes.userId,
			organizationId: mailboxes.organizationId,
			domainId: mailboxes.domainId,
			localPart: mailboxes.localPart,
			displayName: mailboxes.displayName,
			hostname: domains.hostname,
		})
		.from(groupMembers)
		.leftJoin(
			mailboxes,
			and(
				eq(groupMembers.mailboxId, mailboxes.id),
				eq(mailboxes.organizationId, alias.organizationId),
			),
		)
		.leftJoin(domains, eq(mailboxes.domainId, domains.id))
		.where(eq(groupMembers.aliasId, alias.id));

	for (const row of rows) {
		if (row.mailboxId && row.userId && row.localPart && row.hostname) {
			explicitDecisions.push({
				action: "store",
				mailbox: {
					mailboxId: row.mailboxId,
					userId: row.userId,
					organizationId: row.organizationId,
					domainId: row.domainId!,
					localPart: row.localPart,
					hostname: row.hostname,
					displayName: row.displayName,
				},
			});
			continue;
		}
		// Legacy pre-F60 membership rows identify the member by `groupMembers.userId`
		// only. (A row can never carry `mailboxes.userId` without `mailboxes.id`: the
		// left join is on `groupMembers.mailboxId`, so when that column is null the
		// join cannot have matched — the former `?? (!memberMailboxId ? row.userId
		// : null)` recovery arm was unreachable and has been removed, T-42.)
		if (row.legacyUserId) {
			const [mailbox] = await db
				.select({ id: mailboxes.id })
				.from(mailboxes)
				.where(and(eq(mailboxes.userId, row.legacyUserId), eq(mailboxes.domainId, domain.id)))
				.limit(1);
			members.push({ mailboxId: mailbox?.id ?? null, email: mailbox ? null : row.email });
		} else if (!row.memberMailboxId) {
			members.push({ mailboxId: null, email: row.email });
		}
	}

	return { explicitDecisions, members };
}

/**
 * Expand a matched alias into delivery decisions: a simple alias yields at most
 * one decision, a group alias fans out to every member mailbox/forward target.
 * Returns an empty array when nothing resolves so the caller can fall back to
 * ordinary routing.
 */
async function resolveAliasDecisions(
	db: AppDatabase,
	alias: Alias,
	domain: ActiveDomain,
): Promise<RoutingDecision[]> {
	const { explicitDecisions, members } = alias.isGroup
		? await resolveGroupMembers(db, alias, domain)
		: { explicitDecisions: [], members: [] };

	const targets = expandAliasTargets(alias, members);
	const decisions: RoutingDecision[] = [...explicitDecisions];
	for (const target of targets) {
		if (target.type === "forward") {
			decisions.push({
				action: "forward",
				forwardTo: target.address,
				organizationId: alias.organizationId,
			});
		} else {
			const decision = await loadMailboxDecision(
				db,
				target.mailboxId,
				alias.organizationId,
				domain.id,
				domain.hostname,
			);
			if (decision) decisions.push(decision);
		}
	}
	return decisions;
}

/**
 * Resolve an inbound address to one or more delivery decisions.
 *
 * Aliases are consulted first: a simple alias yields a single decision, while a
 * group alias (`team@domain`) fans out to every member mailbox/forward target.
 * When no alias matches, this falls back to the routing-rule/direct-mailbox
 * resolution shared with {@link resolveInboundAddress}, reusing the domain row
 * already loaded here.
 */
export async function resolveInboundTargets(
	db: AppDatabase,
	toAddress: string,
): Promise<RoutingDecision[]> {
	const parsed = parseAddress(toAddress);
	if (!parsed) return [];

	const domain = await loadActiveDomain(db, parsed.domain);
	if (!domain) return [];

	const [alias] = await db
		.select()
		.from(aliases)
		.where(and(eq(aliases.domainId, domain.id), eq(aliases.localPart, parsed.local)))
		.limit(1);

	if (alias) {
		const decisions = await resolveAliasDecisions(db, alias, domain);
		if (decisions.length > 0) return decisions;
	}

	const single = await resolveAddressInDomain(db, domain, parsed);
	return single ? [single] : [];
}

export async function resolveInboundAddress(
	db: AppDatabase,
	toAddress: string,
): Promise<RoutingDecision | null> {
	const parsed = parseAddress(toAddress);
	if (!parsed) return null;

	const domain = await loadActiveDomain(db, parsed.domain);
	if (!domain) return null;

	return resolveAddressInDomain(db, domain, parsed);
}

async function resolveAddressInDomain(
	db: AppDatabase,
	domain: ActiveDomain,
	parsed: ParsedInboundAddress,
): Promise<RoutingDecision | null> {
	const rules = await db
		.select()
		.from(routingRules)
		.where(eq(routingRules.domainId, domain.id))
		.orderBy(desc(routingRules.priority));

	const normalizedAddress = `${parsed.local}@${parsed.domain}`;
	for (const pattern of [normalizedAddress, parsed.local]) {
		for (const rule of rules) {
			if (rule.pattern.toLowerCase() !== pattern) continue;
			const decision = await resolveRuleDecision(db, rule, domain.id, domain.hostname);
			if (decision) return decision;
		}
	}

	const [mailbox] = await db
		.select()
		.from(mailboxes)
		.where(and(eq(mailboxes.domainId, domain.id), eq(mailboxes.localPart, parsed.local)))
		.limit(1);

	if (mailbox) {
		return {
			action: "store",
			mailbox: {
				mailboxId: mailbox.id,
				userId: mailbox.userId,
				organizationId: mailbox.organizationId,
				domainId: domain.id,
				localPart: mailbox.localPart,
				hostname: domain.hostname,
				displayName: mailbox.displayName,
			},
		};
	}

	for (const rule of rules) {
		if (rule.pattern !== "*") continue;
		const decision = await resolveRuleDecision(db, rule, domain.id, domain.hostname);
		if (decision) return decision;
	}

	return null;
}
