import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/handler";
import type { SessionUser } from "@/lib/auth/session";
import { userHasMailboxes } from "@/lib/user";

export const GET = withUser(async ({ env, user }) => {
	const hasMailboxes = await userHasMailboxes(env, user.id);
	return NextResponse.json({
		user: {
			id: user.id,
			email: user.email,
			name: user.name,
			resetEmail: user.resetEmail,
			// getCurrentUser resolves a SessionUser; the wrapper's static type
			// just doesn't carry the optional org-membership role.
			role: (user as SessionUser).role,
		},
		hasMailboxes,
	});
});
