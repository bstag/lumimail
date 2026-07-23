export type MailboxDetail = {
	id: string;
	userId: string;
	domainId: string;
	localPart: string;
	displayName: string | null;
	createdAt: string;
	hostname: string;
	isPrimary?: boolean;
	role: "viewer" | "responder" | "manager";
};

export type MailboxDetailResponse = {
	mailbox?: MailboxDetail;
	error?: string;
};

export type MailboxRole = "viewer" | "responder" | "manager";

export type MailboxMember = {
	id: string;
	userId: string;
	name: string;
	email: string;
	role: MailboxRole;
	createdAt: string;
	updatedAt: string;
};

export type WorkspaceMember = {
	userId: string;
	name: string;
	email: string;
};

export type MailboxMembersData = {
	members: MailboxMember[];
	workspaceMembers: WorkspaceMember[];
};
