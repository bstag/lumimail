"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authFetch, clearLegacySessionToken } from "@/lib/auth/client";
import { isOrganizationAdminRole } from "@/lib/auth/roles";
import {
	AuthSessionContext,
	type AuthSession,
} from "./auth-session-context";
import type { AuthGuardProps } from "./auth-guard-types";

type GuardOptions = Pick<AuthGuardProps, "mode" | "requireMailbox" | "requireOrgAdmin" | "requireOrgOwner"> & { pathname: string };

function publicRedirect(session: AuthSession, mode: AuthGuardProps["mode"]) {
	if (mode !== "public") return null;
	return session.hasMailboxes === false ? "/onboarding" : "/inbox";
}

function mailboxRedirect(session: AuthSession, options: GuardOptions) {
	if (needsOnboarding(session, options)) return "/onboarding";
	if (needsInboxAfterOnboarding(session, options)) return "/inbox";
	return null;
}

function needsOnboarding(session: AuthSession, options: GuardOptions) {
	return options.requireMailbox && session.hasMailboxes === false && options.pathname !== "/onboarding";
}

function needsInboxAfterOnboarding(session: AuthSession, options: GuardOptions) {
	return !options.requireMailbox && !!session.hasMailboxes && options.pathname === "/onboarding";
}

function roleRedirect(session: AuthSession, options: GuardOptions) {
	if (lacksAdminRole(session, options)) return "/inbox";
	if (lacksOwnerRole(session, options)) return "/inbox";
	return null;
}

function lacksAdminRole(session: AuthSession, options: GuardOptions) {
	return !!options.requireOrgAdmin && !isOrganizationAdminRole(session.user?.role);
}

function lacksOwnerRole(session: AuthSession, options: GuardOptions) {
	return !!options.requireOrgOwner && session.user?.role !== "owner";
}

function getAuthRedirect(session: AuthSession, options: GuardOptions) {
	return publicRedirect(session, options.mode) ?? mailboxRedirect(session, options) ?? roleRedirect(session, options);
}

export function AuthGuard({
	children,
	mode = "protected",
	requireMailbox,
	requireOrgAdmin,
	requireOrgOwner,
}: AuthGuardProps) {
	const pathname = usePathname();
	const router = useRouter();
	const [authorized, setAuthorized] = useState(mode === "public");
	const [session, setSession] = useState<AuthSession | null>(null);

	useEffect(() => {
		let cancelled = false;
		clearLegacySessionToken();

		async function checkSession() {
			const response = await authFetch("/api/auth/me", { redirectOnUnauthorized: mode === "protected" });
			if (cancelled) return;

			if (!response.ok) {
				if (mode === "public") setAuthorized(true);
				return;
			}

			const data = (await response.json()) as AuthSession;
			const redirect = getAuthRedirect(data, { mode, pathname, requireMailbox, requireOrgAdmin, requireOrgOwner });
			if (redirect) {
				router.replace(redirect);
				return;
			}

			setSession(data);
			setAuthorized(true);
		}

		void checkSession();

		return () => {
			cancelled = true;
		};
	}, [mode, pathname, requireMailbox, requireOrgAdmin, requireOrgOwner, router]);

	if (!authorized) return null;
	return (
		<AuthSessionContext.Provider value={session}>
			{children}
		</AuthSessionContext.Provider>
	);
}
