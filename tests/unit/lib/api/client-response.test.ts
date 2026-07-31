import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiResponseError, apiJson, parseApiResponse } from "@/lib/api/client-response";
import { authFetch } from "@/lib/auth/client";

vi.mock("@/lib/auth/client", () => ({
	authFetch: vi.fn(),
}));

const authFetchMock = vi.mocked(authFetch);

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

	// The bare `{ error: "..." }` string is still produced by `guardUser` and
	// the pre-envelope routes (moved here from readRoutingResponse).
	it("still understands the bare error string guardUser returns", async () => {
		await expect(
			parseApiResponse(jsonResponse({ error: "Unauthorized" }, 401)),
		).rejects.toEqual(expect.objectContaining({ message: "Unauthorized", status: 401 }));
	});

	it("rejects a blank bare error string as invalid", async () => {
		await expect(parseApiResponse(jsonResponse({ error: "   " }, 400))).rejects.toEqual(
			expect.objectContaining({ message: "Invalid API response", status: 400 }),
		);
	});

	it("does not expose non-string error payloads", async () => {
		await expect(
			parseApiResponse(jsonResponse({ error: { detail: "hidden" } }, 500)),
		).rejects.toEqual(expect.objectContaining({ message: "Invalid API response", status: 500 }));
	});

	it("rejects bare success bodies unless allowBareBody is set", async () => {
		await expect(parseApiResponse(jsonResponse({ id: "r1" }))).rejects.toEqual(
			expect.objectContaining({ message: "Invalid API response", status: 200 }),
		);

		await expect(
			parseApiResponse<{ id: string }>(jsonResponse({ id: "r1" }), { allowBareBody: true }),
		).resolves.toEqual({ id: "r1" });
	});

	it("still unwraps the canonical envelope when bare bodies are allowed", async () => {
		await expect(
			parseApiResponse<{ rules: string[] }>(
				jsonResponse({ success: true, data: { rules: ["r1"] } }),
				{ allowBareBody: true },
			),
		).resolves.toEqual({ rules: ["r1"] });

		await expect(
			parseApiResponse(
				jsonResponse(
					{ success: false, error: { message: "Register this forwarding destination before using it" } },
					422,
				),
				{ allowBareBody: true },
			),
		).rejects.toEqual(
			expect.objectContaining({
				message: "Register this forwarding destination before using it",
				status: 422,
			}),
		);
	});

	it("never passes a failing response through as a bare body", async () => {
		await expect(
			parseApiResponse(jsonResponse({ id: "r1" }, 500), { allowBareBody: true }),
		).rejects.toEqual(expect.objectContaining({ message: "Invalid API response", status: 500 }));

		await expect(
			parseApiResponse(jsonResponse(null, 500), { allowBareBody: true }),
		).rejects.toEqual(expect.objectContaining({ message: "Invalid API response", status: 500 }));
	});
});

describe("apiJson", () => {
	beforeEach(() => {
		authFetchMock.mockReset();
	});

	it("performs a GET without a body or content type and unwraps the payload", async () => {
		authFetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "item_1" } }));

		await expect(apiJson.get<{ id: string }>("/api/items")).resolves.toEqual({ id: "item_1" });

		expect(authFetchMock).toHaveBeenCalledWith("/api/items", { method: "GET" });
	});

	it("passes bare pre-envelope bodies through", async () => {
		authFetchMock.mockResolvedValue(jsonResponse({ domains: [{ id: "d1" }] }));

		await expect(apiJson.get<{ domains: Array<{ id: string }> }>("/api/domains")).resolves.toEqual({
			domains: [{ id: "d1" }],
		});
	});

	it("serializes POST bodies with the JSON content type", async () => {
		authFetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "new_1" } }));

		await expect(apiJson.post<{ id: string }>("/api/items", { name: "One" })).resolves.toEqual({
			id: "new_1",
		});

		expect(authFetchMock).toHaveBeenCalledWith("/api/items", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "One" }),
		});
	});

	it("performs a bodyless POST without a content type", async () => {
		authFetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ok: true } }));

		await expect(apiJson.post("/api/items/refresh")).resolves.toEqual({ ok: true });

		expect(authFetchMock).toHaveBeenCalledWith("/api/items/refresh", { method: "POST" });
	});

	it("serializes PATCH bodies", async () => {
		authFetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "item_1" } }));

		await apiJson.patch("/api/items/item_1", { role: "admin" });

		expect(authFetchMock).toHaveBeenCalledWith("/api/items/item_1", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ role: "admin" }),
		});
	});

	it("performs DELETE requests and supports an optional body", async () => {
		authFetchMock.mockResolvedValue(jsonResponse({ ok: true }));
		await expect(apiJson.delete("/api/items/item_1")).resolves.toEqual({ ok: true });
		expect(authFetchMock).toHaveBeenCalledWith("/api/items/item_1", { method: "DELETE" });

		authFetchMock.mockResolvedValue(jsonResponse({ ok: true }));
		await apiJson.delete("/api/items/item_2", { confirm: "yes" });
		expect(authFetchMock).toHaveBeenLastCalledWith("/api/items/item_2", {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirm: "yes" }),
		});
	});

	it("surfaces server error messages from either error shape", async () => {
		authFetchMock.mockResolvedValue(jsonResponse({ error: "API key not found" }, 404));
		await expect(apiJson.delete("/api/api-keys/key_1")).rejects.toEqual(
			expect.objectContaining({ message: "API key not found", status: 404 }),
		);

		authFetchMock.mockResolvedValue(
			jsonResponse({ success: false, error: { message: "Address already exists" } }, 409),
		);
		await expect(apiJson.post("/api/aliases", { localPart: "x" })).rejects.toEqual(
			expect.objectContaining({ message: "Address already exists", status: 409 }),
		);
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
