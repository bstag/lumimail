import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResendProvider } from "@/lib/email/providers/resend";
import { OutboundProviderError } from "@/lib/email/providers/types";

const message = {
	from: "agent@example.com",
	to: "user@elsewhere.com",
	subject: "Hello",
	html: "<p>Hi</p>",
	text: "Hi",
};

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
	return {
		ok: init?.ok ?? true,
		status: init?.status ?? 200,
		json: async () => body,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
	} as unknown as Response;
}

describe("createResendProvider", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("throws when RESEND_API_KEY is missing", () => {
		expect(() => createResendProvider({} as CloudflareEnv)).toThrow(/RESEND_API_KEY is required/);
	});

	it("exposes the resend id", () => {
		const provider = createResendProvider({ RESEND_API_KEY: "re_x" } as CloudflareEnv);
		expect(provider.id).toBe("resend");
	});

	it("posts to the default endpoint with auth and normalized body", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ id: "re-123" }));
		const provider = createResendProvider({ RESEND_API_KEY: "re_secret" } as CloudflareEnv);

		const result = await provider.send(message);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.resend.com/emails");
		expect(init.method).toBe("POST");
		expect(init.headers.Authorization).toBe("Bearer re_secret");
		expect(init.headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(init.body)).toEqual({
			from: "agent@example.com",
			to: ["user@elsewhere.com"],
			subject: "Hello",
			html: "<p>Hi</p>",
			text: "Hi",
		});
		expect(result).toEqual({ providerMessageId: "re-123" });
	});

	it("honors RESEND_BASE_URL and strips trailing slashes", async () => {
		fetchMock.mockResolvedValue(jsonResponse({ id: "re-789" }));
		const provider = createResendProvider({
			RESEND_API_KEY: "re_secret",
			RESEND_BASE_URL: "https://proxy.internal/resend//",
		} as CloudflareEnv);

		await provider.send(message);

		expect(fetchMock.mock.calls[0][0]).toBe("https://proxy.internal/resend/emails");
	});

	it("classifies a 4xx response as permanent without storing the response body", async () => {
		fetchMock.mockResolvedValue(jsonResponse("domain not verified", { ok: false, status: 422 }));
		const provider = createResendProvider({ RESEND_API_KEY: "re_secret" } as CloudflareEnv);

		await expect(provider.send(message)).rejects.toMatchObject({
			message: "Resend send failed (422)",
			code: "HTTP_422",
			retryable: false,
		});
	});

	it.each([429, 500, 503])("classifies HTTP %s as retryable", async (status) => {
		fetchMock.mockResolvedValue(jsonResponse("temporary detail", { ok: false, status }));
		const provider = createResendProvider({ RESEND_API_KEY: "re_secret" } as CloudflareEnv);

		await expect(provider.send(message)).rejects.toMatchObject({
			code: `HTTP_${status}`,
			retryable: true,
		});
	});

	it("classifies a network failure as retryable", async () => {
		fetchMock.mockRejectedValue(new TypeError("fetch failed"));
		const provider = createResendProvider({ RESEND_API_KEY: "re_secret" } as CloudflareEnv);

		const promise = provider.send(message);
		await expect(promise).rejects.toBeInstanceOf(OutboundProviderError);
		await expect(promise).rejects.toMatchObject({
			message: "Resend network request failed",
			code: "NETWORK_ERROR",
			retryable: true,
		});
	});

	it("treats a malformed success response as permanent", async () => {
		fetchMock.mockResolvedValue(jsonResponse({}));
		const provider = createResendProvider({ RESEND_API_KEY: "re_secret" } as CloudflareEnv);

		await expect(provider.send(message)).rejects.toMatchObject({
			message: "Resend send failed: response did not include a message id",
			code: "INVALID_RESPONSE",
			retryable: false,
		});
	});
});
