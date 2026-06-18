import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	authFetch,
	clearClientSessionToken,
	getAuthHeaders,
	getClientSessionToken,
	persistAuthSession,
	setClientSessionToken,
} from "@/lib/auth/client";

const STORAGE_KEY = "lumimail-session-token";

function makeStorage() {
	const store = new Map<string, string>();
	return {
		getItem: vi.fn((k: string) => (store.has(k) ? store.get(k)! : null)),
		setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
		removeItem: vi.fn((k: string) => void store.delete(k)),
		_store: store,
	};
}

let storage: ReturnType<typeof makeStorage>;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
	storage = makeStorage();
	assign = vi.fn();
	vi.stubGlobal("localStorage", storage);
	vi.stubGlobal("window", { location: { assign } });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("getClientSessionToken", () => {
	it("returns null when window is undefined", () => {
		vi.stubGlobal("window", undefined);
		expect(getClientSessionToken()).toBeNull();
	});

	it("returns null when localStorage throws", () => {
		storage.getItem.mockImplementation(() => {
			throw new Error("denied");
		});
		expect(getClientSessionToken()).toBeNull();
	});

	it("returns the stored token", () => {
		storage._store.set(STORAGE_KEY, "tok1");
		expect(getClientSessionToken()).toBe("tok1");
	});

	it("returns null when no token is stored", () => {
		expect(getClientSessionToken()).toBeNull();
	});
});

describe("setClientSessionToken", () => {
	it("writes the token to storage", () => {
		setClientSessionToken("tok2");
		expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "tok2");
		expect(storage._store.get(STORAGE_KEY)).toBe("tok2");
	});

	it("swallows storage errors", () => {
		storage.setItem.mockImplementation(() => {
			throw new Error("denied");
		});
		expect(() => setClientSessionToken("tok2")).not.toThrow();
	});
});

describe("clearClientSessionToken", () => {
	it("removes the token from storage", () => {
		storage._store.set(STORAGE_KEY, "tok3");
		clearClientSessionToken();
		expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
		expect(storage._store.has(STORAGE_KEY)).toBe(false);
	});

	it("swallows storage errors", () => {
		storage.removeItem.mockImplementation(() => {
			throw new Error("denied");
		});
		expect(() => clearClientSessionToken()).not.toThrow();
	});
});

describe("getAuthHeaders", () => {
	it("adds a Bearer header when a token exists and none is set", () => {
		storage._store.set(STORAGE_KEY, "tok4");
		const headers = getAuthHeaders();
		expect(headers.get("Authorization")).toBe("Bearer tok4");
	});

	it("does not overwrite an existing Authorization header", () => {
		storage._store.set(STORAGE_KEY, "tok4");
		const headers = getAuthHeaders({ Authorization: "Bearer existing" });
		expect(headers.get("Authorization")).toBe("Bearer existing");
	});

	it("leaves headers untouched when no token exists", () => {
		const headers = getAuthHeaders();
		expect(headers.get("Authorization")).toBeNull();
	});
});

describe("authFetch", () => {
	it("attaches auth headers and returns the response on success", async () => {
		storage._store.set(STORAGE_KEY, "tok5");
		const response = { status: 200 } as Response;
		const fetchMock = vi.fn(async () => response);
		vi.stubGlobal("fetch", fetchMock);

		const result = await authFetch("/api/x", { method: "POST" });
		expect(result).toBe(response);
		const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
		expect((init.headers as Headers).get("Authorization")).toBe("Bearer tok5");
		expect(init.method).toBe("POST");
	});

	it("clears the token and redirects on 401 by default", async () => {
		storage._store.set(STORAGE_KEY, "tok6");
		const response = { status: 401 } as Response;
		vi.stubGlobal("fetch", vi.fn(async () => response));

		await authFetch("/api/x");
		expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
		expect(assign).toHaveBeenCalledWith("/login");
	});

	it("does not redirect when redirectOnUnauthorized is false", async () => {
		const response = { status: 401 } as Response;
		vi.stubGlobal("fetch", vi.fn(async () => response));

		await authFetch("/api/x", { redirectOnUnauthorized: false });
		expect(assign).not.toHaveBeenCalled();
	});

	it("does not redirect on non-401 responses", async () => {
		const response = { status: 500 } as Response;
		vi.stubGlobal("fetch", vi.fn(async () => response));

		await authFetch("/api/x");
		expect(assign).not.toHaveBeenCalled();
	});

	it("does not redirect when window is undefined", async () => {
		vi.stubGlobal("window", undefined);
		const response = { status: 401 } as Response;
		vi.stubGlobal("fetch", vi.fn(async () => response));

		const result = await authFetch("/api/x");
		expect(result).toBe(response);
		expect(assign).not.toHaveBeenCalled();
	});
});

describe("persistAuthSession", () => {
	it("stores the token when the response is ok and a token is present", async () => {
		const response = { ok: true, json: async () => ({ token: "tok7" }) } as unknown as Response;
		const data = await persistAuthSession(response);
		expect(data).toEqual({ token: "tok7" });
		expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "tok7");
	});

	it("does not store a token when the response is not ok", async () => {
		const response = { ok: false, json: async () => ({ token: "tok8" }) } as unknown as Response;
		await persistAuthSession(response);
		expect(storage.setItem).not.toHaveBeenCalled();
	});

	it("does not store a token when none is returned", async () => {
		const response = { ok: true, json: async () => ({}) } as unknown as Response;
		const data = await persistAuthSession(response);
		expect(data).toEqual({});
		expect(storage.setItem).not.toHaveBeenCalled();
	});
});
