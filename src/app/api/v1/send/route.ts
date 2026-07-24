import { getEnv } from "@/lib/cloudflare";
import { authenticateApiKey, requireScope } from "@/lib/api/auth";
import { sendEmailSchema } from "@/lib/validators";
import { sendEmail } from "@/lib/email/send";
import { apiSuccess, apiError } from "@/lib/api/response";
import {
	AttachmentValidationError,
	MAX_ATTACHMENT_BYTES,
	MAX_ATTACHMENT_COUNT,
	decodeBase64Attachment,
	validateOutboundAttachments,
} from "@/lib/email/outbound-attachments";

type ApiAttachment = {
	filename?: unknown;
	contentType?: unknown;
	contentBase64?: unknown;
};

export async function POST(request: Request) {
	const env = getEnv();
	const auth = await authenticateApiKey(env, request.headers.get("authorization"));
	if (!auth || !requireScope(auth.scopes, "send")) {
		return apiError("Unauthorized", 401);
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json() as Record<string, unknown>;
	} catch {
		return apiError("Validation failed", 400);
	}
	const parsed = sendEmailSchema.safeParse(body);
	if (!parsed.success) return apiError("Validation failed", 400, parsed.error.flatten());

	try {
		const rawAttachments = body.attachments;
		if (rawAttachments !== undefined && !Array.isArray(rawAttachments)) {
			throw new AttachmentValidationError("Attachments must be an array");
		}
		if (Array.isArray(rawAttachments) && rawAttachments.length > MAX_ATTACHMENT_COUNT) {
			throw new AttachmentValidationError(`Too many attachments (max ${MAX_ATTACHMENT_COUNT})`);
		}
		const attachments = validateOutboundAttachments({
			...parsed.data,
			attachments: (rawAttachments ?? []).map((value: ApiAttachment) => {
				if (
					typeof value !== "object" ||
					value === null ||
					typeof value.filename !== "string" ||
					typeof value.contentType !== "string" ||
					typeof value.contentBase64 !== "string"
				) {
					throw new AttachmentValidationError("Invalid attachment");
				}
				if (value.contentBase64.length > 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3)) {
					throw new AttachmentValidationError("Attachment too large (max 3 MiB)");
				}
				return {
					filename: value.filename,
					contentType: value.contentType,
					content: decodeBase64Attachment(value.contentBase64),
				};
			}),
		});
		const result = await sendEmail(env, {
			userId: auth.userId,
			...parsed.data,
			...(attachments.length ? { attachments } : {}),
		});
		return apiSuccess(result, 202);
	} catch (error) {
		if (error instanceof AttachmentValidationError) {
			return apiError(error.message, 400);
		}
		if (error instanceof Error && error.name === "SenderNotAllowedError") {
			return apiError("Mailbox not found", 404);
		}
		if (error instanceof Error && error.name === "ReplySourceNotAllowedError") {
			return apiError("Reply source not found", 404);
		}
		return apiError("Send failed", 500);
	}
}
