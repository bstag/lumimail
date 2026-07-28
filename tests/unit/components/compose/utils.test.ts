import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { submitMessage } from "@/components/compose/utils";

beforeEach(() => authFetch.mockReset());

describe("submitMessage", () => {
	it("submits the message and attachments atomically as multipart", async () => {
		authFetch.mockResolvedValue(Response.json({
			success: true,
			data: { messageId: "msg_1", status: "queued" },
		}));
		const input = {
			from: "a@example.com",
			to: "b@example.com",
			subject: "Hi",
			text: "Body",
			html: "<p><strong>Body</strong></p>",
			mailboxId: "mbx_1",
		};
		const file = new File(["hello"], "hello.txt", { type: "text/plain" });
		await expect(submitMessage(input, [file])).resolves.toEqual({ messageId: "msg_1", status: "queued" });
		const [, options] = authFetch.mock.calls[0];
		expect(options.body).toBeInstanceOf(FormData);
		expect(options.body.get("payload")).toBe(JSON.stringify(input));
		expect(options.body.getAll("attachment")).toEqual([file]);
	});

	it("submits inline-image files with their content IDs", async () => {
		authFetch.mockResolvedValue(Response.json({
			success: true,
			data: { messageId: "msg_1", status: "queued" },
		}));
		const file = new File(["png"], "chart.png", { type: "image/png" });
		await submitMessage(
			{
				from: "a@example.com", to: "b@example.com", subject: "Chart",
				text: "[Image: chart.png]", html: '<img src="cid:chart_1" alt="chart.png">',
			},
			[],
			[{ file, contentId: "chart_1" }],
		);
		const body = authFetch.mock.calls[0][1].body as FormData;
		expect(body.getAll("inlineImage")).toEqual([file]);
		expect(body.getAll("inlineImageId")).toEqual(["chart_1"]);
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
