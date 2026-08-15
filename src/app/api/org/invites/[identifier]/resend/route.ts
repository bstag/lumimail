import { withOrgAdmin } from "@/lib/api/handler";
import { apiError, apiSuccess } from "@/lib/api/response";
import { resendOrganizationInvitation } from "@/lib/organization-invitations";

export const POST = withOrgAdmin<{ identifier: string }>(async ({ env, user, params }) => {
	let result: Awaited<ReturnType<typeof resendOrganizationInvitation>>;
	try {
		result = await resendOrganizationInvitation(env, {
			organizationId: user.organizationId,
			inviteId: params.identifier,
		});
	} catch {
		console.error(JSON.stringify({ message: "organization invitation resend failed" }));
		return apiError("Invitation service temporarily unavailable", 503);
	}
	switch (result.status) {
		case "not-found": return apiError("Invitation not found", 404);
		case "accepted": return apiError("Invitation already accepted", 409);
		case "rate-limited": return apiError("Please wait before resending", 429);
		case "unavailable": return apiError("Invitation service temporarily unavailable", 503);
		case "resent": return apiSuccess({ invite: {
			id: result.inviteId,
			token: result.token,
			deliveryStatus: result.deliveryStatus,
		} });
	}
});
