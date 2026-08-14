"use client";

import { AuthGuard } from "@/components/auth/auth-guard";

/**
 * Guard-only layout: organization routes share the settings chrome from the
 * parent `(settings)` layout and add the admin requirement here, so the shell
 * never has to know which pages are privileged. Owner-only pages (Operations,
 * Queue health) additionally keep their own `requireOrgOwner` guard.
 */
export default function OrganizationSettingsLayout({ children }: { children: React.ReactNode }) {
	return (
		<AuthGuard requireMailbox requireOrgAdmin>
			{children}
		</AuthGuard>
	);
}
