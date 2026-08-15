import { cookies } from "next/headers";
import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { newId } from "@/lib/ids";
import { isSameOriginMutation } from "@/lib/mcp/authorization-request";
import { renamePushDevice, revokePushDevice } from "@/lib/push/devices";
import { pushDeviceRenameSchema } from "@/lib/validators";

function mutationGuard(request: Request, env: CloudflareEnv, organizationId: string | null) {
	if (!env.PUBLIC_APP_URL) return apiError("Push notifications are unavailable", 503);
	if (!isSameOriginMutation(request, env.PUBLIC_APP_URL)) return apiError("Forbidden", 403);
	if (!organizationId) return apiError("No active organization", 403);
	return null;
}

export const PATCH = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	const guard = mutationGuard(request, env, user.organizationId);
	if (guard) return guard;
	const organizationId = user.organizationId as string;
	const parsed = await parseJsonBody(request, pushDeviceRenameSchema);
	if (parsed.errorResponse) return parsed.errorResponse;
	const result = await renamePushDevice(env, {
		deviceId: params.id,
		userId: user.id,
		organizationId,
		name: parsed.data.name,
		requestId: newId("req"),
	});
	if (result.status === "not-found") return apiError("Device not found", 404);
	return apiSuccess({ updated: true });
});

export const DELETE = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	const guard = mutationGuard(request, env, user.organizationId);
	if (guard) return guard;
	const organizationId = user.organizationId as string;
	const result = await revokePushDevice(env, {
		deviceId: params.id,
		userId: user.id,
		organizationId,
		sessionToken: (await cookies()).get(SESSION_COOKIE)?.value,
		requestId: newId("req"),
	});
	if (result.status === "recent-auth-required") return apiError("Recent authentication required", 403);
	if (result.status === "not-found") return apiError("Device not found", 404);
	return apiSuccess({ revoked: true });
});
