import { cookies } from "next/headers";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { getBearerToken } from "@/lib/auth/cookies";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { isSameOriginMutation } from "@/lib/mcp/authorization-request";
import { listPushDevices, registerPushDevice } from "@/lib/push/devices";
import { pushDeviceCreateSchema } from "@/lib/validators";

async function sessionToken(request: Request) {
	return getBearerToken(request) ?? (await cookies()).get(SESSION_COOKIE)?.value;
}

export const GET = withUser(async ({ request, env, user }) => {
	if (!user.organizationId) return apiError("No active organization", 403);
	return apiSuccess(await listPushDevices(env, {
		userId: user.id,
		organizationId: user.organizationId,
		sessionToken: await sessionToken(request),
	}));
});

export const POST = withUser(async ({ request, env, user }) => {
	const appUrl = env.PUBLIC_APP_URL;
	if (!appUrl) return apiError("Push notifications are unavailable", 503);
	if (!isSameOriginMutation(request, appUrl)) return apiError("Forbidden", 403);
	if (!user.organizationId) return apiError("No active organization", 403);
	const parsed = await parseJsonBody(request, pushDeviceCreateSchema);
	if (parsed.errorResponse) return parsed.errorResponse;
	const result = await registerPushDevice(env, {
		userId: user.id,
		organizationId: user.organizationId,
		sessionToken: await sessionToken(request),
		name: parsed.data.name,
		subscription: parsed.data.subscription,
		requestId: newId("req"),
	});
	if (result.status === "invalid-session") return apiError("Current session is invalid", 403);
	if (result.status === "conflict") return apiError("Push subscription is already registered", 409);
	if (result.status === "limit") return apiError("Active device limit reached", 429);
	return apiSuccess({ device: result.device }, result.status === "created" ? 201 : 200);
});
