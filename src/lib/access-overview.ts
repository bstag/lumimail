import { and, eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { domains, mailboxMemberships, mailboxes, organizationMembers, users } from "@/db/schema";

export type OrganizationRole = "owner" | "admin" | "member";
export type AccessMailboxRole = "viewer" | "responder" | "manager";
export type AccessCapability = "read" | "send" | "manage";

type MemberRow = {
	id: string;
	userId: string;
	organizationId: string;
	name: string;
	email: string;
	organizationRole: OrganizationRole;
};

type MailboxRow = {
	id: string;
	organizationId: string | null;
	localPart: string;
	hostname: string;
	displayName: string | null;
};

type GrantRow = {
	id: string;
	userId: string;
	mailboxId: string;
	role: string;
	memberOrganizationId: string;
	mailboxOrganizationId: string | null;
};

export type AccessOverview = ReturnType<typeof buildAccessOverview>;

export function mailboxCapabilities(role: string): AccessCapability[] {
	switch (role) {
		case "viewer": return ["read"];
		case "responder": return ["read", "send"];
		case "manager": return ["read", "send", "manage"];
		default: return [];
	}
}

export function buildAccessOverview(
	organizationId: string,
	memberRows: readonly MemberRow[],
	mailboxRows: readonly MailboxRow[],
	grantRows: readonly GrantRow[],
) {
	const scopedMembers = memberRows.filter((member) => member.organizationId === organizationId);
	const scopedMailboxes = mailboxRows.filter((mailbox) => mailbox.organizationId === organizationId);
	const membersByUserId = new Map(scopedMembers.map((member) => [member.userId, member]));
	const mailboxesById = new Map(scopedMailboxes.map((mailbox) => [mailbox.id, mailbox]));
	const grantsByUserId = new Map<string, Array<{
		id: string;
		mailboxId: string;
		address: string;
		displayName: string | null;
		role: AccessMailboxRole;
		capabilities: AccessCapability[];
	}>>();
	const assignedByMailbox = new Map<string, Set<string>>();

	for (const grant of grantRows) {
		if (grant.memberOrganizationId !== organizationId || grant.mailboxOrganizationId !== organizationId) continue;
		if (!membersByUserId.has(grant.userId)) continue;
		const mailbox = mailboxesById.get(grant.mailboxId);
		if (!mailbox) continue;
		const capabilities = mailboxCapabilities(grant.role);
		if (capabilities.length === 0) continue;

		const grants = grantsByUserId.get(grant.userId) ?? [];
		grants.push({
			id: grant.id,
			mailboxId: grant.mailboxId,
			address: `${mailbox.localPart}@${mailbox.hostname}`,
			displayName: mailbox.displayName,
			role: grant.role as AccessMailboxRole,
			capabilities,
		});
		grantsByUserId.set(grant.userId, grants);

		const assigned = assignedByMailbox.get(grant.mailboxId) ?? new Set<string>();
		assigned.add(grant.userId);
		assignedByMailbox.set(grant.mailboxId, assigned);
	}

	return {
		members: scopedMembers
			.map((member) => ({
				id: member.id,
				userId: member.userId,
				name: member.name,
				email: member.email,
				organizationRole: member.organizationRole,
				grants: (grantsByUserId.get(member.userId) ?? [])
					.sort((a, b) => a.address.localeCompare(b.address)),
			}))
			.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email)),
		mailboxes: scopedMailboxes
			.map((mailbox) => ({
				id: mailbox.id,
				address: `${mailbox.localPart}@${mailbox.hostname}`,
				displayName: mailbox.displayName,
				assignedMemberCount: assignedByMailbox.get(mailbox.id)?.size ?? 0,
			}))
			.sort((a, b) => a.address.localeCompare(b.address)),
	};
}

export async function readAccessOverview(env: CloudflareEnv, organizationId: string): Promise<AccessOverview> {
	return readAccessOverviewFromDb(getDb(env), organizationId);
}

export async function readAccessOverviewFromDb(db: AppDatabase, organizationId: string): Promise<AccessOverview> {
	const memberRows = await db
		.select({
			id: organizationMembers.id,
			userId: organizationMembers.userId,
			organizationId: organizationMembers.organizationId,
			name: users.name,
			email: users.email,
			organizationRole: organizationMembers.role,
		})
		.from(organizationMembers)
		.innerJoin(users, eq(users.id, organizationMembers.userId))
		.where(eq(organizationMembers.organizationId, organizationId));

	const mailboxRows = await db
		.select({
			id: mailboxes.id,
			organizationId: mailboxes.organizationId,
			localPart: mailboxes.localPart,
			hostname: domains.hostname,
			displayName: mailboxes.displayName,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(domains.id, mailboxes.domainId))
		.where(eq(mailboxes.organizationId, organizationId));

	const grantRows = await db
		.select({
			id: mailboxMemberships.id,
			userId: mailboxMemberships.userId,
			mailboxId: mailboxMemberships.mailboxId,
			role: mailboxMemberships.role,
			memberOrganizationId: organizationMembers.organizationId,
			mailboxOrganizationId: mailboxes.organizationId,
		})
		.from(mailboxMemberships)
		.innerJoin(mailboxes, eq(mailboxes.id, mailboxMemberships.mailboxId))
		.innerJoin(
			organizationMembers,
			and(
				eq(organizationMembers.userId, mailboxMemberships.userId),
				eq(organizationMembers.organizationId, organizationId),
			),
		)
		.where(eq(mailboxes.organizationId, organizationId));

	return buildAccessOverview(organizationId, memberRows, mailboxRows, grantRows);
}
