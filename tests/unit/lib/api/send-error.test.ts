import { describe, expect, it } from "vitest";
import { mapSendError } from "@/lib/api/send-error";
import { AttachmentValidationError } from "@/lib/email/outbound-attachments";

async function body(response: Response) {
	return (await response.json()) as { success: boolean; error: { message: string } };
}

describe("mapSendError", () => {
	it("maps an attachment validation failure to a 400 with its message", async () => {
		const res = mapSendError(new AttachmentValidationError("Attachment too large (max 3 MiB)"));
		expect(res.status).toBe(400);
		expect(await body(res)).toEqual({
			success: false,
			error: { message: "Attachment too large (max 3 MiB)" },
		});
	});

	it("maps a sender denial to a non-confirming 404", async () => {
		const error = new Error("denied");
		error.name = "SenderNotAllowedError";
		const res = mapSendError(error);
		expect(res.status).toBe(404);
		expect((await body(res)).error.message).toBe("Mailbox not found");
	});

	it("maps a reply-source denial to a non-confirming 404", async () => {
		const error = new Error("denied");
		error.name = "ReplySourceNotAllowedError";
		const res = mapSendError(error);
		expect(res.status).toBe(404);
		expect((await body(res)).error.message).toBe("Reply source not found");
	});

	it("maps any other Error to a generic 500", async () => {
		const res = mapSendError(new Error("smtp down"));
		expect(res.status).toBe(500);
		expect((await body(res)).error.message).toBe("Send failed");
	});

	it("maps a non-Error value to the generic 500", async () => {
		const res = mapSendError("boom");
		expect(res.status).toBe(500);
		expect((await body(res)).error.message).toBe("Send failed");
	});
});
