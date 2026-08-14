import { withUser } from "@/lib/api/handler";
import { apiError, apiSuccess, parseJsonBody } from "@/lib/api/response";
import { newId } from "@/lib/ids";
import { isSameOriginMutation } from "@/lib/mcp/authorization-request";
import { replacePushDevicePreferences } from "@/lib/push/devices";
import { pushDevicePreferencesSchema } from "@/lib/validators";

export const PUT = withUser<{ id: string }>(async ({ request, env, user, params }) => {
	if (!env.PUBLIC_APP_URL) return apiError("Push notifications are unavailable", 503);
	if (!isSameOriginMutation(request, env.PUBLIC_APP_URL)) return apiError("Forbidden", 403);
	if (!user.organizationId) return apiError("No active organization", 403);
	const parsed = await parseJsonBody(request, pushDevicePreferencesSchema);
	if (parsed.errorResponse) return parsed.errorResponse;
	const result = await replacePushDevicePreferences(env, {
		deviceId: params.id,
		userId: user.id,
		organizationId: user.organizationId,
		mailboxIds: parsed.data.mailboxIds,
		requestId: newId("req"),
	});
	if (result.status === "not-found" || result.status === "forbidden-mailbox") {
		return apiError("Device not found", 404);
	}
	return apiSuccess({ mailboxIds: result.mailboxIds });
});
