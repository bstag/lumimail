"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authFetch, getClientSessionToken } from "@/lib/auth/client";
import { isOrganizationAdminRole } from "@/lib/auth/roles";
import {
	AuthSessionContext,
	type AuthSession,
} from "./auth-session-context";
import type { AuthGuardProps } from "./auth-guard-types";

export function AuthGuard({
	children,
	mode = "protected",
	requireMailbox,
	requireOrgAdmin,
}: AuthGuardProps) {
	const pathname = usePathname();
	const router = useRouter();
	const [authorized, setAuthorized] = useState(mode === "public");
	const [session, setSession] = useState<AuthSession | null>(null);

	useEffect(() => {
		let cancelled = false;
		const token = getClientSessionToken();

		if (!token) {
			if (mode === "protected") router.replace("/login");
			return;
		}

		async function checkSession() {
			const response = await authFetch("/api/auth/me", { redirectOnUnauthorized: mode === "protected" });
			if (cancelled) return;

			if (!response.ok) {
				if (mode === "public") setAuthorized(true);
				return;
			}

			const data = (await response.json()) as AuthSession;
			if (mode === "public") {
				router.replace(data.hasMailboxes === false ? "/onboarding" : "/inbox");
				return;
			}

			if (requireMailbox && data.hasMailboxes === false && pathname !== "/onboarding") {
				router.replace("/onboarding");
				return;
			}

			if (!requireMailbox && data.hasMailboxes && pathname === "/onboarding") {
				router.replace("/inbox");
				return;
			}

			if (requireOrgAdmin && !isOrganizationAdminRole(data.user?.role)) {
				router.replace("/inbox");
				return;
			}

			setSession(data);
			setAuthorized(true);
		}

		void checkSession();

		return () => {
			cancelled = true;
		};
	}, [mode, pathname, requireMailbox, requireOrgAdmin, router]);

	if (!authorized) return null;
	return (
		<AuthSessionContext.Provider value={session}>
			{children}
		</AuthSessionContext.Provider>
	);
}
