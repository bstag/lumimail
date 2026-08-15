import { cookies } from "next/headers";
import { withOrgOwner } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { getBearerToken } from "@/lib/auth/cookies";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { recordMailFlowEvidence } from "@/lib/mail-flow-evidence";
import { mailFlowEvidenceProofSchema } from "@/lib/validators";

export const POST = withOrgOwner(async ({ request, env, user }) => {
	const parsed = await parseJsonBody(request, mailFlowEvidenceProofSchema);
	if (parsed.errorResponse) return parsed.errorResponse;

	const bearerToken = getBearerToken(request);
	const cookieToken = bearerToken ? undefined : (await cookies()).get(SESSION_COOKIE)?.value;
	try {
		const result = await recordMailFlowEvidence(env, {
			organizationId: user.organizationId,
			actorUserId: user.id,
			currentToken: bearerToken ?? cookieToken,
			deliveredMessageId: parsed.data.deliveredMessageId,
			deliveredInReplyTo: parsed.data.deliveredInReplyTo,
			deliveredReferences: parsed.data.deliveredReferences,
			observedAt: new Date(parsed.data.observedAt),
		});
		if (result.status === "recent-auth-required") return apiError("Recent authentication required", 403);
		if (result.status === "invalid") return apiError("Invalid mail-flow proof", 400);
		if (result.status === "conflict") return apiError("Evidence already exists with a different result", 409);
		if (result.outcome === undefined || result.passedChecks === undefined || result.totalChecks === undefined) {
			throw new Error("missing derived result");
		}
		return apiSuccess({
			recorded: true,
			duplicate: result.status === "duplicate",
			outcome: result.outcome,
			passedChecks: result.passedChecks,
			totalChecks: result.totalChecks,
		}, result.status === "recorded" ? 201 : 200);
	} catch {
		console.error(JSON.stringify({ message: "mail-flow evidence recording failed" }));
		return apiError("Mail-flow evidence could not be recorded", 500);
	}
});
