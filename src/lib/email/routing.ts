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
};

type RoutingRule = typeof routingRules.$inferSelect;

async function loadMailboxDecision(
	db: AppDatabase,
	mailboxId: string,
	domainId: string,
	hostname: string,
): Promise<RoutingDecision | null> {
	const [mailbox] = await db
		.select()
		.from(mailboxes)
		.where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.domainId, domainId)))
		.limit(1);
	if (!mailbox) return null;
	return {
		action: "store",
		mailbox: {
			mailboxId: mailbox.id,
			userId: mailbox.userId,
			organizationId: mailbox.organizationId,
			domainId,
			localPart: mailbox.localPart,
			hostname,
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
		return rule.forwardTo ? { action: "forward", forwardTo: rule.forwardTo } : null;
	}
	return rule.mailboxId
		? loadMailboxDecision(db, rule.mailboxId, domainId, hostname)
		: null;
}

/**
 * Resolve an inbound address to one or more delivery decisions.
 *
 * Aliases are consulted first: a simple alias yields a single decision, while a
 * group alias (`team@domain`) fans out to every member mailbox/forward target.
 * When no alias matches, this falls back to {@link resolveInboundAddress} so
 * routing rules and direct mailbox delivery keep working unchanged.
 */
export async function resolveInboundTargets(
	db: AppDatabase,
	toAddress: string,
): Promise<RoutingDecision[]> {
	const parsed = parseAddress(toAddress);
	if (!parsed) return [];

	const [domain] = await db
		.select()
		.from(domains)
		.where(and(eq(domains.hostname, parsed.domain), eq(domains.status, "active")))
		.limit(1);
	if (!domain) return [];

	const [alias] = await db
		.select()
		.from(aliases)
		.where(and(eq(aliases.domainId, domain.id), eq(aliases.localPart, parsed.local)))
		.limit(1);

	if (alias) {
		let members: { mailboxId: string | null; email: string | null }[] = [];
		if (alias.isGroup) {
			const rows = await db
				.select()
				.from(groupMembers)
				.where(eq(groupMembers.aliasId, alias.id));
			members = await Promise.all(
				rows.map(async (row) => {
					if (row.userId) {
						const [mailbox] = await db
							.select({ id: mailboxes.id })
							.from(mailboxes)
							.where(and(eq(mailboxes.userId, row.userId), eq(mailboxes.domainId, domain.id)))
							.limit(1);
						return { mailboxId: mailbox?.id ?? null, email: mailbox ? null : row.email };
					}
					return { mailboxId: null, email: row.email };
				}),
			);
		}

		const targets = expandAliasTargets(alias, members);
		const decisions: RoutingDecision[] = [];
		for (const target of targets) {
			if (target.type === "forward") {
				decisions.push({ action: "forward", forwardTo: target.address });
			} else {
				const decision = await loadMailboxDecision(db, target.mailboxId, domain.id, domain.hostname);
				if (decision) decisions.push(decision);
			}
		}
		if (decisions.length > 0) return decisions;
	}

	const single = await resolveInboundAddress(db, toAddress);
	return single ? [single] : [];
}

export async function resolveInboundAddress(
	db: AppDatabase,
	toAddress: string,
): Promise<RoutingDecision | null> {
	const parsed = parseAddress(toAddress);
	if (!parsed) return null;

	const [domain] = await db
		.select()
		.from(domains)
		.where(and(eq(domains.hostname, parsed.domain), eq(domains.status, "active")))
		.limit(1);

	if (!domain) return null;

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
