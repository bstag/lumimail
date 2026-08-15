import { cookies } from "next/headers";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import {
	disconnectExternalAccount,
	getExternalAccount,
	updateExternalAccount,
} from "@/lib/email/external/account-management";
import { normalizePublicAppOrigin } from "@/lib/email/external/oauth-provider";
import { isSameOriginMutation } from "@/lib/mcp/authorization-request";
import { externalAccountUpdateSchema } from "@/lib/validators";

export const GET = withUser<{ id: string }>(async ({ env, user, params }) => {
	if (!user.organizationId) return apiError("No active organization", 403);
	const account = await getExternalAccount(env, user.id, user.organizationId, params.id);
	return account ? apiSuccess({ account }) : apiError("External account not found", 404);
});

export const PATCH = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	if (!user.organizationId) return apiError("No active organization", 403);
	let origin: string;
	try {
		origin = normalizePublicAppOrigin(env.PUBLIC_APP_URL);
	} catch {
		return apiError("External accounts are unavailable", 503);
	}
	if (!isSameOriginMutation(request, origin)) return apiError("Forbidden", 403);
	const parsed = await parseJsonBody(request, externalAccountUpdateSchema);
	if (parsed.errorResponse) return parsed.errorResponse;
	if (parsed.data.retainOriginal) {
		const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
		const session = await readRecentlyAuthenticatedSession(env, user.id, sessionToken);
		if (!session || session.organizationId !== user.organizationId) {
			return apiError("Recent authentication required", 403);
		}
	}
	const result = await updateExternalAccount(
		env, user.id, user.organizationId, params.id, parsed.data,
	);
	if (result.status === "not-found") return apiError("External account not found", 404);
	if (result.status === "conflict") return apiError("External account state conflict", 409);
	return apiSuccess({ ok: true });
});

export const DELETE = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	if (!user.organizationId) return apiError("No active organization", 403);
	let origin: string;
	try {
		origin = normalizePublicAppOrigin(env.PUBLIC_APP_URL);
	} catch {
		return apiError("External accounts are unavailable", 503);
	}
	if (!isSameOriginMutation(request, origin)) return apiError("Forbidden", 403);
	const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
	const session = await readRecentlyAuthenticatedSession(env, user.id, sessionToken);
	if (!session || session.organizationId !== user.organizationId) {
		return apiError("Recent authentication required", 403);
	}
	const result = await disconnectExternalAccount(env, user.id, user.organizationId, params.id);
	if (result.status === "not-found") return apiError("External account not found", 404);
	if (result.status === "conflict") return apiError("External account state conflict", 409);
	return apiSuccess({ ok: true });
});
