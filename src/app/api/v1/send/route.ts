import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { authenticateApiKey, requireScope } from "@/lib/api/auth";
import { sendEmailSchema } from "@/lib/validators";
import { sendEmail } from "@/lib/email/send";
import { apiSuccess, apiError } from "@/lib/api/response";

export async function POST(request: Request) {
	const env = getEnv();
	const auth = await authenticateApiKey(env, request.headers.get("authorization"));
	if (!auth || !requireScope(auth.scopes, "send")) {
		return apiError("Unauthorized", 401);
	}

	const body = await request.json() as Record<string, unknown>;
	const parsed = sendEmailSchema.safeParse(body);
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	try {
		const result = await sendEmail(env, { userId: auth.userId, ...parsed.data });
		return apiSuccess(result);
	} catch (error) {
		if (error instanceof Error && error.name === "SenderNotAllowedError") {
			return apiError("Mailbox not found", 404);
		}
		return apiError("Send failed", 500);
	}
}
