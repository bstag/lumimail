import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, apiSuccess } from "@/lib/api/response";

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
