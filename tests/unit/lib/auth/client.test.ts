import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	authFetch,
	clearClientSessionToken,
	clearLegacySessionToken,
	persistAuthSession,
} from "@/lib/auth/client";

const SESSION_KEY = "lumimail-session-token";
const MAILBOX_KEY = "selected-mailbox-id";
let removeItem: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
	removeItem = vi.fn();
	assign = vi.fn();
	vi.stubGlobal("localStorage", { removeItem });
	vi.stubGlobal("window", { location: { assign } });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("cookie-only browser sessions", () => {
	it("removes legacy token material and account-scoped state", () => {
		clearClientSessionToken();
		expect(removeItem).toHaveBeenCalledWith(SESSION_KEY);
		expect(removeItem).toHaveBeenCalledWith(MAILBOX_KEY);
	});

	it("can remove only the legacy token during a route check", () => {
		clearLegacySessionToken();
		expect(removeItem).toHaveBeenCalledWith(SESSION_KEY);
		expect(removeItem).not.toHaveBeenCalledWith(MAILBOX_KEY);
	});

	it("never adds an Authorization header from browser storage", async () => {
		const response = { status: 200 } as Response;
		const fetchMock = vi.fn(async () => response);
		vi.stubGlobal("fetch", fetchMock);

		await authFetch("/api/x", { method: "POST" });

		const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
		expect(new Headers(init.headers).get("Authorization")).toBeNull();
		expect(init.credentials).toBe("same-origin");
	});

	it("clears legacy state and redirects after a 401", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401 }) as Response));
		await authFetch("/api/x");
		expect(removeItem).toHaveBeenCalledWith(SESSION_KEY);
		expect(assign).toHaveBeenCalledWith("/login");
	});

	it("can suppress the unauthorized redirect", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401 }) as Response));
		await authFetch("/api/x", { redirectOnUnauthorized: false });
		expect(assign).not.toHaveBeenCalled();
	});

	it("preserves an explicitly selected credentials mode", async () => {
		const fetchMock = vi.fn(async () => ({ status: 200 }) as Response);
		vi.stubGlobal("fetch", fetchMock);
		await authFetch("/api/x", { credentials: "include" });
		expect(fetchMock).toHaveBeenCalledWith("/api/x", expect.objectContaining({
			credentials: "include",
		}));
	});

	it("does not fail when storage is unavailable", () => {
		removeItem.mockImplementation(() => {
			throw new Error("denied");
		});
		expect(() => clearClientSessionToken()).not.toThrow();
	});

	it("is safe during server rendering", () => {
		vi.stubGlobal("window", undefined);
		expect(() => clearLegacySessionToken()).not.toThrow();
		expect(removeItem).not.toHaveBeenCalled();
	});

	it("persists authentication only through the response cookie", async () => {
		const response = {
			ok: true,
			json: async () => ({ redirect: "/inbox" }),
		} as unknown as Response;
		expect(await persistAuthSession(response)).toEqual({ redirect: "/inbox" });
		expect(removeItem).toHaveBeenCalledWith(SESSION_KEY);
	});

	it("does not clear account state for an unsuccessful authentication response", async () => {
		const response = {
			ok: false,
			json: async () => ({ error: "Invalid credentials" }),
		} as unknown as Response;
		expect(await persistAuthSession(response)).toEqual({ error: "Invalid credentials" });
		expect(removeItem).not.toHaveBeenCalled();
	});
});
