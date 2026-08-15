import { withUser } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { pushVapidPublicKeySchema } from "@/lib/validators";

export const GET = withUser(async ({ env }) => {
	const configured = (env as CloudflareEnv & { VAPID_PUBLIC_KEY?: string }).VAPID_PUBLIC_KEY;
	const parsed = pushVapidPublicKeySchema.safeParse(configured);
	return apiSuccess(parsed.success
		? { available: true, vapidPublicKey: parsed.data }
		: { available: false, vapidPublicKey: null });
});
