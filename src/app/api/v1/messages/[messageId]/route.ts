import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { authenticateApiKey, requireScope } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { getMessageWithBody } from "@/lib/email/inbound";
import { updateMessageForImap } from "@/lib/email/imap-state";

type MessageRouteParams = {
	params: Promise<{ messageId: string }>;
};

const updateSchema = z
	.object({
		read: z.boolean().optional(),
		status: z.literal("trash").optional(),
	})
	.strict()
	.refine((value) => value.read !== undefined || value.status !== undefined, {
		message: "At least one state change is required",
	});

function getMailboxId(request: Request): string | null {
	const mailboxId = new URL(request.url).searchParams.get("mailboxId")?.trim();
	return mailboxId || null;
}

async function authorize(request: Request) {
	const env = getEnv();
	const auth = await authenticateApiKey(env, request.headers.get("authorization"));
	if (!auth || !requireScope(auth.scopes, "read")) return { env, auth: null };
	return { env, auth };
}

export async function GET(request: Request, { params }: MessageRouteParams) {
	const { env, auth } = await authorize(request);
	if (!auth) return apiError("Unauthorized", 401);
	const mailboxId = getMailboxId(request);
	if (!mailboxId) return apiError("mailboxId is required", 400);
	const { messageId } = await params;
	const data = await getMessageWithBody(env, auth.userId, auth.organizationId, messageId, mailboxId);
	if (!data) return apiError("Message not found", 404);
	return apiSuccess(data);
}

export async function PATCH(request: Request, { params }: MessageRouteParams) {
	const { env, auth } = await authorize(request);
	if (!auth) return apiError("Unauthorized", 401);
	const mailboxId = getMailboxId(request);
	if (!mailboxId) return apiError("mailboxId is required", 400);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError("Invalid JSON", 400);
	}
	const parsed = updateSchema.safeParse(body);
	if (!parsed.success) return apiError("Invalid state change", 400, parsed.error.flatten());

	const { messageId } = await params;
	const message = await updateMessageForImap(
		env,
		auth.userId,
		auth.organizationId,
		messageId,
		mailboxId,
		parsed.data,
	);
	if (!message) return apiError("Message not found", 404);
	return apiSuccess({ message });
}
