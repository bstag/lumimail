import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { submitMessage, uploadMessageAttachment } from "@/components/compose/utils";

beforeEach(() => authFetch.mockReset());

describe("submitMessage", () => {
	it("unwraps the message id required by attachment upload", async () => {
		authFetch.mockResolvedValue(Response.json({
			success: true,
			data: { messageId: "msg_1", status: "queued" },
		}));
		const input = { from: "a@example.com", to: "b@example.com", subject: "Hi", text: "Body", mailboxId: "mbx_1" };
		await expect(submitMessage(input)).resolves.toEqual({ messageId: "msg_1", status: "queued" });
		expect(authFetch).toHaveBeenCalledWith("/api/send", expect.objectContaining({ body: JSON.stringify(input) }));
	});

	it("surfaces the canonical send error", async () => {
		authFetch.mockResolvedValue(
			Response.json({ success: false, error: { message: "Send rate limit exceeded" } }, { status: 429 }),
		);
		await expect(submitMessage({ from: "a@example.com", to: "b@example.com", subject: "", text: "" })).rejects.toThrow(
			"Send rate limit exceeded",
		);
	});
});

describe("uploadMessageAttachment", () => {
	it("unwraps a successful attachment response", async () => {
		authFetch.mockResolvedValue(Response.json({ success: true, data: { id: "att_1" } }));
		const file = new File(["hello"], "hello.txt", { type: "text/plain" });
		await expect(uploadMessageAttachment("msg_1", file)).resolves.toBeUndefined();
		const [, options] = authFetch.mock.calls[0];
		expect(options.method).toBe("POST");
		expect(options.body).toBeInstanceOf(FormData);
		expect(options.body.get("messageId")).toBe("msg_1");
	});

	it("rejects a canonical attachment error", async () => {
		authFetch.mockResolvedValue(
			Response.json({ success: false, error: { message: "File too large" } }, { status: 400 }),
		);
		await expect(uploadMessageAttachment("msg_1", new File(["x"], "x.txt"))).rejects.toThrow("File too large");
	});
});
