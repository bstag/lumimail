import { withUser } from "@/lib/api/handler";
import { sendEmailSchema } from "@/lib/validators";
import { sendEmail } from "@/lib/email/send";
import { enforceRateLimit, rateLimitUser } from "@/lib/rate-limit";
import { apiSuccess, apiError } from "@/lib/api/response";
import { mapSendError } from "@/lib/api/send-error";
import {
	AttachmentValidationError,
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENT_COUNT,
	validateOutboundAttachments,
	type ValidatedOutboundAttachment,
} from "@/lib/email/outbound-attachments";

async function parseRequest(request: Request): Promise<{
	body: unknown;
	attachments?: ValidatedOutboundAttachment[];
}> {
	const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
	if (contentType.includes("application/json")) {
		return { body: await request.json() };
	}
	if (!contentType.includes("multipart/form-data")) {
		throw new AttachmentValidationError("Unsupported request content type");
	}
	const form = await request.formData();
	const payload = form.get("payload");
	if (typeof payload !== "string") {
		throw new AttachmentValidationError("Multipart payload is required");
	}
	let body: unknown;
	try {
		body = JSON.parse(payload);
	} catch {
		throw new AttachmentValidationError("Multipart payload must be valid JSON");
	}
	const parsedBody = sendEmailSchema.safeParse(body);
	if (!parsedBody.success) return { body };
	const files = form.getAll("attachment");
	const inlineFiles = form.getAll("inlineImage");
	const inlineIds = form.getAll("inlineImageId");
	if (files.some((value) => !(value instanceof File))) {
		throw new AttachmentValidationError("Attachment fields must contain files");
	}
	if (
		inlineFiles.some((value) => !(value instanceof File))
		|| inlineIds.some((value) => typeof value !== "string")
		|| inlineFiles.length !== inlineIds.length
	) {
		throw new AttachmentValidationError("Inline image metadata is invalid");
	}
	if (files.length + inlineFiles.length > MAX_ATTACHMENT_COUNT) {
		throw new AttachmentValidationError(`Too many attachments (max ${MAX_ATTACHMENT_COUNT})`);
	}
	if ([...files, ...inlineFiles].some((file) => (file as File).size > MAX_ATTACHMENT_BYTES)) {
		throw new AttachmentValidationError("Attachment too large (max 3 MiB)");
	}
	const inputs = await Promise.all([
		...(files as File[]).map(async (file) => ({
			filename: file.name,
			contentType: file.type,
			content: await file.arrayBuffer(),
			disposition: "attachment" as const,
		})),
		...(inlineFiles as File[]).map(async (file, index) => ({
			filename: file.name,
			contentType: file.type,
			content: await file.arrayBuffer(),
			disposition: "inline" as const,
			contentId: inlineIds[index] as string,
		})),
	]);
	return {
		body,
		attachments: validateOutboundAttachments({ ...parsedBody.data, attachments: inputs }),
	};
}

export const POST = withUser(async ({ request, env, user }) => {
	const limited = await enforceRateLimit(rateLimitUser(env, user.id, "send", 50, 3_600_000), {
		unavailableLog: "Send rate limit unavailable",
		limitedMessage: "Send rate limit exceeded",
		respond: apiError,
	});
	if (limited) return limited;

	let requestData: Awaited<ReturnType<typeof parseRequest>>;
	try {
		requestData = await parseRequest(request);
	} catch (error) {
		if (error instanceof AttachmentValidationError) {
			const status = error.message === "Unsupported request content type" ? 415 : 400;
			return apiError(error.message, status);
		}
		return apiError("Validation failed", 400);
	}
	const parsed = sendEmailSchema.safeParse(requestData.body);
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	try {
		const result = await sendEmail(env, {
			userId: user.id,
			...parsed.data,
			...(requestData.attachments?.length ? { attachments: requestData.attachments } : {}),
		});
		return apiSuccess(result, 202);
	} catch (error) {
		return mapSendError(error);
	}
});
