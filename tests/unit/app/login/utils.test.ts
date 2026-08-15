import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const persistAuthSession = vi.fn();
vi.mock("@/lib/auth/client", () => ({
	persistAuthSession: (...a: unknown[]) => persistAuthSession(...a),
}));

import { resolveLoginRedirect, submitLogin } from "@/app/login/utils";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	persistAuthSession.mockReset();
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("submitLogin", () => {
	it("posts credentials and returns the persisted session with ok=true", async () => {
		const response = { ok: true } as Response;
		fetchMock.mockResolvedValue(response);
		persistAuthSession.mockResolvedValue({ token: "t" });

		const form = new FormData();
		form.set("email", "user@example.com");
		form.set("password", "secret");

		const result = await submitLogin(form);

		expect(result).toEqual({ ok: true, data: { token: "t" } });
		expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "user@example.com", password: "secret" }),
		});
		expect(persistAuthSession).toHaveBeenCalledWith(response);
	});

	it("reports ok=false when the response is not ok", async () => {
		fetchMock.mockResolvedValue({ ok: false } as Response);
		persistAuthSession.mockResolvedValue({ error: "bad" });

		const result = await submitLogin(new FormData());

		expect(result.ok).toBe(false);
		expect(result.data).toEqual({ error: "bad" });
	});
});

describe("resolveLoginRedirect", () => {
	it("preserves an OAuth continuation only as a local absolute path", () => {
		expect(resolveLoginRedirect("/inbox", `?redirect=${encodeURIComponent("/oauth/authorize?client_id=a")}`))
			.toBe("/oauth/authorize?client_id=a");
		for (const unsafe of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
			expect(resolveLoginRedirect("/inbox", `?redirect=${encodeURIComponent(unsafe)}`)).toBe("/inbox");
		}
		expect(resolveLoginRedirect(undefined, "")).toBe("/inbox");
	});
});
