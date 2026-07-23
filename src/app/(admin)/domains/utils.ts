import { parseApiResponse } from "@/lib/api/client-response";
import { authFetch } from "@/lib/auth/client";
import type { Domain } from "./types";

export type DomainMutationResult = {
	domain: Domain;
	dns: unknown;
};

export async function createDomain(hostname: string): Promise<DomainMutationResult> {
	const response = await authFetch("/api/domains", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ hostname, enableRouting: true, enableSending: true }),
	});
	return parseApiResponse<DomainMutationResult>(response);
}

export async function fetchDomainDns(id: string): Promise<DomainMutationResult> {
	const response = await authFetch(`/api/domains/${id}/dns`);
	return parseApiResponse<DomainMutationResult>(response);
}

export async function reconcileDomainSending(
	id: string,
	action: "verify" | "enable",
): Promise<DomainMutationResult> {
	const response = await authFetch(`/api/domains/${id}/sending`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action }),
	});
	return parseApiResponse<DomainMutationResult>(response);
}
