import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import type { DomainCreateResult, DomainListResult, MailboxCreateResult } from "./types";

export async function getDomains(): Promise<DomainListResult> {
	const res = await authFetch("/api/domains");
	return (await res.json()) as DomainListResult;
}

export async function createDomain(hostname: string): Promise<{ ok: boolean; data: DomainCreateResult }> {
	const res = await authFetch("/api/domains", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ hostname, enableRouting: true, enableSending: true }),
	});

	try {
		return { ok: true, data: await parseApiResponse<DomainCreateResult>(res) };
	} catch (error) {
		return { ok: false, data: { error: (error as Error).message } };
	}
}

export async function createMailbox(
	domainId: string,
	localPart: string,
): Promise<{ ok: boolean; data: MailboxCreateResult }> {
	const res = await authFetch("/api/mailboxes", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ domainId, localPart, displayName: localPart }),
	});

	try {
		return { ok: true, data: await parseApiResponse<MailboxCreateResult>(res) };
	} catch (error) {
		return { ok: false, data: { error: (error as Error).message } };
	}
}
