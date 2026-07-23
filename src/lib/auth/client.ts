"use client";

import type { AuthFetchOptions, AuthSessionResponse } from "./client-types";
import { resetAccountScopedClientState } from "./account-state";

const SESSION_STORAGE_KEY = "lumimail-session-token";

function safeStorageGet(key: string): string | null {
	if (typeof window === "undefined") return null;
	try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key: string, value: string): void {
	try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function safeStorageRemove(key: string): void {
	try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

export function getClientSessionToken(): string | null {
	return safeStorageGet(SESSION_STORAGE_KEY);
}

export function setClientSessionToken(token: string): void {
	resetAccountScopedClientState();
	safeStorageSet(SESSION_STORAGE_KEY, token);
}

export function clearClientSessionToken(): void {
	safeStorageRemove(SESSION_STORAGE_KEY);
	resetAccountScopedClientState();
}

export function getAuthHeaders(headers?: HeadersInit): Headers {
	const nextHeaders = new Headers(headers);
	const token = getClientSessionToken();
	if (token && !nextHeaders.has("Authorization")) {
		nextHeaders.set("Authorization", `Bearer ${token}`);
	}
	return nextHeaders;
}

export async function authFetch(input: RequestInfo | URL, init: AuthFetchOptions = {}): Promise<Response> {
	const { redirectOnUnauthorized = true, headers, ...requestInit } = init;
	const response = await fetch(input, {
		...requestInit,
		headers: getAuthHeaders(headers),
	});

	if (response.status === 401 && redirectOnUnauthorized && typeof window !== "undefined") {
		clearClientSessionToken();
		window.location.assign("/login");
	}

	return response;
}

export async function persistAuthSession(response: Response): Promise<AuthSessionResponse> {
	const data = (await response.json()) as AuthSessionResponse;
	if (response.ok && data.token) setClientSessionToken(data.token);
	return data;
}
