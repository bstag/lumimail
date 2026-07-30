"use client";

import type { AuthFetchOptions, AuthSessionResponse } from "./client-types";
import { resetAccountScopedClientState } from "./account-state";

const SESSION_STORAGE_KEY = "lumimail-session-token";

function safeStorageRemove(key: string): void {
	if (typeof window === "undefined") return;
	try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

/** Remove tokens left by pre-F74 clients without changing current account state. */
export function clearLegacySessionToken(): void {
	safeStorageRemove(SESSION_STORAGE_KEY);
}

/** Clear all browser state when the authenticated account changes or signs out. */
export function clearClientSessionToken(): void {
	clearLegacySessionToken();
	resetAccountScopedClientState();
}

export async function authFetch(input: RequestInfo | URL, init: AuthFetchOptions = {}): Promise<Response> {
	const { redirectOnUnauthorized = true, ...requestInit } = init;
	const response = await fetch(input, {
		...requestInit,
		credentials: requestInit.credentials ?? "same-origin",
	});

	if (response.status === 401 && redirectOnUnauthorized && typeof window !== "undefined") {
		clearClientSessionToken();
		window.location.assign("/login");
	}

	return response;
}

export async function persistAuthSession(response: Response): Promise<AuthSessionResponse> {
	const data = (await response.json()) as AuthSessionResponse;
	if (response.ok) clearClientSessionToken();
	return data;
}
