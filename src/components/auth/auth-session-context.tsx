"use client";

import { createContext, useContext } from "react";
import type { OrganizationRole } from "@/lib/auth/roles";

export type AuthSession = {
	user: {
		id: string;
		email?: string;
		name?: string | null;
		resetEmail?: string | null;
		role?: OrganizationRole | null;
	};
	hasMailboxes?: boolean;
};

export const AuthSessionContext = createContext<AuthSession | null>(null);

export function useAuthSession() {
	return useContext(AuthSessionContext);
}
