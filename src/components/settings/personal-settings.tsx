"use client";

import { useAuthSession } from "@/components/auth/auth-session-context";
import { ProfileForm } from "./profile-form";

export function PersonalSettings() {
	const session = useAuthSession();
	if (!session?.user.email) return null;
	return (
		<ProfileForm
			initialName={session.user.name ?? ""}
			initialResetEmail={session.user.resetEmail ?? ""}
			email={session.user.email}
		/>
	);
}
