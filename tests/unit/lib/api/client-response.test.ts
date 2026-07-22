import { describe, expect, it } from "vitest";
import { ApiResponseError, parseApiResponse } from "@/lib/api/client-response";

function jsonResponse(body: unknown, status = 200): Response {
	return Response.json(body, { status });
}

describe("parseApiResponse", () => {
	it("returns data from a successful canonical response", async () => {
		await expect(
			parseApiResponse<{ id: string }>(jsonResponse({ success: true, data: { id: "item_1" } })),
		).resolves.toEqual({ id: "item_1" });
	});

	it("preserves falsey data values", async () => {
		await expect(parseApiResponse<null>(jsonResponse({ success: true, data: null }))).resolves.toBeNull();
	});

	it("throws the canonical API message and HTTP status", async () => {
		const promise = parseApiResponse(
			jsonResponse({ success: false, error: { message: "Mailbox not found" } }, 404),
		);

		await expect(promise).rejects.toEqual(
			expect.objectContaining({
				name: "ApiResponseError",
				message: "Mailbox not found",
				status: 404,
			}),
		);
	});

	it("rejects malformed JSON without exposing its body", async () => {
		const response = new Response("secret invalid body", {
			status: 502,
			headers: { "Content-Type": "application/json" },
		});

		await expect(parseApiResponse(response)).rejects.toEqual(
			expect.objectContaining({ message: "Invalid API response", status: 502 }),
		);
	});

	it.each([
		null,
		[],
		{},
		{ success: true },
		{ success: false },
		{ success: false, error: null },
		{ success: false, error: { message: 123 } },
		{ success: false, error: { message: "" } },
		{ success: "true", data: {} },
	])("rejects malformed envelopes: %j", async (body) => {
		await expect(parseApiResponse(jsonResponse(body))).rejects.toBeInstanceOf(ApiResponseError);
	});

	it("rejects a non-successful HTTP response that claims success", async () => {
		await expect(
			parseApiResponse(jsonResponse({ success: true, data: { id: "item_1" } }, 500)),
		).rejects.toEqual(expect.objectContaining({ message: "Invalid API response", status: 500 }));
	});
});

describe("ApiResponseError", () => {
	it("stores its message and status", () => {
		const error = new ApiResponseError("Request failed", 418);
		expect(error.name).toBe("ApiResponseError");
		expect(error.message).toBe("Request failed");
		expect(error.status).toBe(418);
	});
});
