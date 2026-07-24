import { getEnv } from "@/lib/cloudflare";
import { guardUser } from "@/lib/auth/cookies";
import { sendEmailSchema } from "@/lib/validators";
import { sendEmail } from "@/lib/email/send";
import { rateLimitUser } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/response";

export async function POST(request: Request) {
	const env = getEnv();
	const { user, errorResponse } = await guardUser(env, request);
	if (errorResponse) return errorResponse;

	const rl = rateLimitUser(user.id, "send", 50, 3_600_000);
	if (!rl.allowed) return apiError("Send rate limit exceeded", 429);

	const parsed = sendEmailSchema.safeParse(await request.json());
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	try {
		const result = await sendEmail(env, { userId: user.id, ...parsed.data });
		return apiSuccess(result, 202);
	} catch (error) {
		if (error instanceof Error && error.name === "SenderNotAllowedError") {
			return apiError("Mailbox not found", 404);
		}
		return apiError("Send failed", 500);
	}
}
