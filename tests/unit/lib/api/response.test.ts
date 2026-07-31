import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError, z } from "zod";
import { apiError, apiSuccess, firstZodMessage, parseJsonBody } from "@/lib/api/response";

describe("apiSuccess", () => {
	it("wraps data with success:true and default 200 status", async () => {
		const res = apiSuccess({ id: "x" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, data: { id: "x" } });
	});

	it("honors a custom status code", async () => {
		const res = apiSuccess({ created: true }, 201);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ success: true, data: { created: true } });
	});
});

describe("apiError", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	it("returns success:false with the message and default 400 status", async () => {
		vi.stubEnv("NODE_ENV", "test");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = apiError("bad request");
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ success: false, error: { message: "bad request" } });
		expect(errorSpy).toHaveBeenCalledWith("API 400: bad request", undefined);
	});

	it("honors a custom status and logs details when not in production", async () => {
		vi.stubEnv("NODE_ENV", "development");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = apiError("nope", 403, { reason: "forbidden" });
		expect(res.status).toBe(403);
		expect(errorSpy).toHaveBeenCalledWith("API 403: nope", { reason: "forbidden" });
	});

	it("does not log in production", async () => {
		vi.stubEnv("NODE_ENV", "production");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const res = apiError("secret detail", 500);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ success: false, error: { message: "secret detail" } });
		expect(errorSpy).not.toHaveBeenCalled();
	});
});

describe("firstZodMessage", () => {
	it("names the offending field so the envelope's single string stays useful", () => {
		const result = z.object({ priority: z.number() }).safeParse({ priority: "high" });

		expect(result.success).toBe(false);
		expect(firstZodMessage(result.error!)).toMatch(/^priority: /);
	});

	it("returns the bare message when the issue has no path to name", () => {
		const result = z.number().safeParse("nope");

		// No field prefix is prepended; the message is passed through unchanged.
		expect(firstZodMessage(result.error!)).toBe(result.error!.issues[0].message);
	});

	it("falls back when an error carries no issues at all", () => {
		expect(firstZodMessage(new ZodError([]))).toBe("Invalid request");
	});
});

describe("parseJsonBody", () => {
	const schema = z.object({ name: z.string().min(1) }).strict();

	function jsonRequest(body: string) {
		return new Request("https://x.test/api/thing", { method: "POST", body });
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns parsed data for a valid body", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await parseJsonBody(jsonRequest(JSON.stringify({ name: "a" })), schema);
		expect(result.errorResponse).toBeNull();
		expect(result.data).toEqual({ name: "a" });
	});

	it("returns an enveloped 400 for malformed JSON instead of throwing", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await parseJsonBody(jsonRequest("{nope"), schema);
		expect(result.data).toBeNull();
		expect(result.errorResponse!.status).toBe(400);
		expect(await result.errorResponse!.json()).toEqual({
			success: false,
			error: { message: "Invalid JSON" },
		});
	});

	it("returns the first Zod issue with its path as an enveloped 400", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const result = await parseJsonBody(jsonRequest(JSON.stringify({ name: "" })), schema);
		expect(result.data).toBeNull();
		expect(result.errorResponse!.status).toBe(400);
		const body = (await result.errorResponse!.json()) as { error: { message: string } };
		expect(body.error.message).toMatch(/^name: /);
	});
});
