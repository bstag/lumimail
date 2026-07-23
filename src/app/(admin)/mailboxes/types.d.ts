export type Mailbox = {
	id: string;
	localPart: string;
	displayName: string | null;
	domainId: string;
	hostname: string;
	isPrimary?: boolean;
	role: "viewer" | "responder" | "manager" | null;
};

export type Domain = {
	id: string;
	hostname: string;
};
