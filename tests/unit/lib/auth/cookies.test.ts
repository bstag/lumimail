import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	getUserFromSession: vi.fn(),
	cookieValue: undefined as string | undefined,
}));

vi.mock("@/lib/auth/session", () => ({
	SESSION_COOKIE: "ep_session",
	getUserFromSession: h.getUserFromSession,
}));

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({
		get: (name: string) =>
			name === "ep_session" && h.cookieValue !== undefined
				? { value: h.cookieValue }
				: undefined,
	})),
}));

vi.mock("next/server", () => ({
	NextResponse: {
		json: vi.fn((body: unknown, init?: { status?: number }) => ({ body, init })),
	},
}));

import { NextResponse } from "next/server";
import { getCurrentUser, guardUser, requireUser } from "@/lib/auth/cookies";

const env = {} as CloudflareEnv;

beforeEach(() => {
	vi.clearAllMocks();
	h.cookieValue = undefined;
	h.getUserFromSession.mockReset();
});

function reqWithAuth(value: string | null): Request {
	return { headers: { get: (n: string) => (n === "Authorization" ? value : null) } } as unknown as Request;
}

describe("getCurrentUser", () => {
	it("uses a bearer token when present", async () => {
		h.getUserFromSession.mockResolvedValue({ id: "u1" });
		const user = await getCurrentUser(env, reqWithAuth("Bearer abc123"));
		expect(user).toEqual({ id: "u1" });
		expect(h.getUserFromSession).toHaveBeenCalledWith(env, "abc123");
	});

	it("ignores a non-Bearer Authorization header and falls back to the cookie", async () => {
		h.cookieValue = "cookietok";
		h.getUserFromSession.mockResolvedValue({ id: "u2" });
		await getCurrentUser(env, reqWithAuth("Basic xyz"));
		expect(h.getUserFromSession).toHaveBeenCalledWith(env, "cookietok");
	});

	it("ignores a blank bearer token and falls back to the cookie", async () => {
		h.cookieValue = "cookietok";
		h.getUserFromSession.mockResolvedValue({ id: "u3" });
		await getCurrentUser(env, reqWithAuth("Bearer    "));
		expect(h.getUserFromSession).toHaveBeenCalledWith(env, "cookietok");
	});

	it("works with no request (cookie only)", async () => {
		h.cookieValue = "cookietok";
		h.getUserFromSession.mockResolvedValue({ id: "u4" });
		await getCurrentUser(env);
		expect(h.getUserFromSession).toHaveBeenCalledWith(env, "cookietok");
	});

	it("passes undefined token when the cookie is absent", async () => {
		h.getUserFromSession.mockResolvedValue(null);
		await getCurrentUser(env);
		expect(h.getUserFromSession).toHaveBeenCalledWith(env, undefined);
	});
});

describe("requireUser", () => {
	it("returns the user when authenticated", async () => {
		h.cookieValue = "tok";
		h.getUserFromSession.mockResolvedValue({ id: "u1" });
		expect(await requireUser(env)).toEqual({ id: "u1" });
	});

	it("throws when unauthenticated", async () => {
		h.getUserFromSession.mockResolvedValue(null);
		await expect(requireUser(env)).rejects.toThrow("Unauthorized");
	});
});

describe("guardUser", () => {
	it("returns the user and a null errorResponse when authenticated", async () => {
		h.cookieValue = "tok";
		h.getUserFromSession.mockResolvedValue({ id: "u1" });
		const result = await guardUser(env);
		expect(result).toEqual({ user: { id: "u1" }, errorResponse: null });
	});

	it("returns a 401 error response when unauthenticated", async () => {
		h.getUserFromSession.mockResolvedValue(null);
		const result = await guardUser(env);
		expect(result.user).toBeNull();
		expect(NextResponse.json).toHaveBeenCalledWith({ error: "Unauthorized" }, { status: 401 });
		expect(result.errorResponse).not.toBeNull();
	});
});
