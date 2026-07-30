import { vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "./db";

/**
 * Shared harness for API route-handler unit tests.
 *
 * Route tests all repeat the same preamble: a `vi.hoisted` mock bag,
 * `vi.mock` calls for `@/lib/cloudflare` / `@/db` / `@/lib/auth/cookies`
 * (and sometimes `@/lib/rate-limit` or `@/lib/auth/org-guard`), plus
 * `beforeEach` resets and a local `Request` builder. This module packages
 * that preamble.
 *
 * `vi.mock` calls are hoisted per-file, so this helper cannot register them
 * for you. Instead, `createRouteMocks()` returns a bag that carries both the
 * mock functions and *module factories* you hand to your own `vi.mock`
 * calls:
 *
 * ```ts
 * import { beforeEach, describe, expect, it, vi } from "vitest";
 * import { createRouteMocks, jsonRequest } from "../../../helpers/route-mocks";
 *
 * // vi.hoisted runs before static imports, so import the harness dynamically
 * // inside it; `await vi.hoisted(async ...)` resolves before the route module
 * // (and therefore any vi.mock factory) is evaluated.
 * const m = await vi.hoisted(async () => {
 *   const { createRouteMocks } = await import("../../../helpers/route-mocks");
 *   return createRouteMocks();
 * });
 * vi.mock("@/lib/cloudflare", () => m.cloudflareModule());
 * vi.mock("@/db", () => m.dbModule());
 * vi.mock("@/lib/auth/cookies", () => m.cookiesModule());
 * vi.mock("@/lib/rate-limit", () => m.rateLimitModule());   // when the route rate-limits
 * vi.mock("@/lib/auth/org-guard", () => m.orgGuardModule()); // for admin/owner routes
 *
 * import { GET, POST } from "@/app/api/labels/route";
 *
 * beforeEach(() => m.reset());
 *
 * it("lists", async () => {
 *   m.dbMock.queueSelect([{ id: "lbl_1" }]);
 *   const res = await GET(new Request("https://x.test/api/labels"));
 *   expect(res.status).toBe(200);
 * });
 * ```
 *
 * Defaults after `reset()` (override per test as needed):
 * - `guardUser`     resolves `{ user: { id: "u1" }, errorResponse: null }`
 * - `getCurrentUser` resolves `{ id: "u1" }` — this also covers routes
 *   migrated to the `withUser` wrapper in `src/lib/api/handler.ts`, which
 *   authenticates via `getCurrentUser` from `@/lib/auth/cookies`.
 * - `requireUser`   resolves `{ id: "u1" }`
 * - `guardOrgAdmin` / `guardOrgUser` resolve
 *   `{ orgUser: { id: "u1", organizationId: "org_1", role: "admin" }, errorResponse: null }`
 *   and `guardOrgOwner` the same with `role: "owner"` — covering both routes
 *   that call the guards directly and routes wrapped in
 *   `withOrgAdmin`/`withOrgOwner` (the wrappers delegate to these guards).
 * - `rateLimitCheck` / `rateLimitIp` / `rateLimitUser` resolve
 *   `{ allowed: true, remaining: 1 }`
 * - `dbMock` is a fresh `createDbMock()` (see `./db`); `dbModule()`'s `getDb`
 *   always returns the *current* `m.dbMock.db`, so `reset()` gives every test
 *   a clean queue without re-wiring.
 *
 * To deny auth in a test:
 * `m.guardUser.mockResolvedValue({ user: null, errorResponse: m.unauthorized() })`
 * or `m.getCurrentUser.mockResolvedValue(null)` for wrapper-based routes.
 */
export function createRouteMocks() {
	const guardUser = vi.fn();
	const getCurrentUser = vi.fn();
	const requireUser = vi.fn();
	const guardOrgAdmin = vi.fn();
	const guardOrgOwner = vi.fn();
	const guardOrgUser = vi.fn();
	const rateLimitCheck = vi.fn();
	const rateLimitIp = vi.fn();
	const rateLimitUser = vi.fn();

	class RateLimitUnavailableError extends Error {
		constructor() {
			super("Rate limit storage unavailable");
			this.name = "RateLimitUnavailableError";
		}
	}

	const bag = {
		/** The env object `cloudflareModule()`'s `getEnv` returns. Mutate freely. */
		env: {} as Record<string, unknown>,
		/** Fresh per `reset()`; queue rows with `m.dbMock.queueSelect([...])`. */
		dbMock: createDbMock() as DbMock,
		guardUser,
		getCurrentUser,
		requireUser,
		guardOrgAdmin,
		guardOrgOwner,
		guardOrgUser,
		rateLimitCheck,
		rateLimitIp,
		rateLimitUser,
		RateLimitUnavailableError,

		/** A fresh 401 response, for `{ errorResponse }` guard results. */
		unauthorized() {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		},

		// ---- module factories: pass to the test file's own vi.mock calls ----

		/** `vi.mock("@/lib/cloudflare", () => m.cloudflareModule())` */
		cloudflareModule(extra?: Record<string, unknown>) {
			return { getEnv: () => bag.env, ...extra };
		},
		/** `vi.mock("@/db", () => m.dbModule())` */
		dbModule(extra?: Record<string, unknown>) {
			return { getDb: () => bag.dbMock.db, ...extra };
		},
		/** `vi.mock("@/lib/auth/cookies", () => m.cookiesModule())` */
		cookiesModule(extra?: Record<string, unknown>) {
			return { guardUser, getCurrentUser, requireUser, ...extra };
		},
		/** `vi.mock("@/lib/auth/org-guard", () => m.orgGuardModule())` */
		orgGuardModule(extra?: Record<string, unknown>) {
			return { guardOrgAdmin, guardOrgOwner, guardOrgUser, ...extra };
		},
		/** `vi.mock("@/lib/rate-limit", () => m.rateLimitModule())` */
		rateLimitModule(extra?: Record<string, unknown>) {
			return {
				rateLimitCheck,
				rateLimitIp,
				rateLimitUser,
				RateLimitUnavailableError,
				...extra,
			};
		},

		/** Call from `beforeEach`: fresh db mock, all fns reset to defaults. */
		reset() {
			bag.dbMock = createDbMock();
			guardUser.mockReset().mockResolvedValue({ user: { id: "u1" }, errorResponse: null });
			getCurrentUser.mockReset().mockResolvedValue({ id: "u1" });
			requireUser.mockReset().mockResolvedValue({ id: "u1" });
			guardOrgAdmin.mockReset().mockResolvedValue({
				orgUser: { id: "u1", organizationId: "org_1", role: "admin" },
				errorResponse: null,
			});
			guardOrgOwner.mockReset().mockResolvedValue({
				orgUser: { id: "u1", organizationId: "org_1", role: "owner" },
				errorResponse: null,
			});
			guardOrgUser.mockReset().mockResolvedValue({
				orgUser: { id: "u1", organizationId: "org_1", role: "admin" },
				errorResponse: null,
			});
			rateLimitCheck.mockReset().mockResolvedValue({ allowed: true, remaining: 1 });
			rateLimitIp.mockReset().mockResolvedValue({ allowed: true, remaining: 1 });
			rateLimitUser.mockReset().mockResolvedValue({ allowed: true, remaining: 1 });
		},
	};

	bag.reset();
	return bag;
}

export type RouteMocks = ReturnType<typeof createRouteMocks>;

/**
 * JSON `Request` builder. `body === undefined` sends no body; pass
 * `{ rawBody: "not json" }` to send a malformed payload.
 */
export function jsonRequest(
	url: string,
	body?: unknown,
	init: RequestInit & { rawBody?: string } = {},
): Request {
	const { rawBody, ...rest } = init;
	return new Request(url, {
		method: "POST",
		...rest,
		body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
	});
}

/** Multipart `Request` builder for upload-style routes. */
export function multipartRequest(url: string, form: FormData, init: RequestInit = {}): Request {
	return new Request(url, { method: "POST", ...init, body: form });
}

/** Next.js dynamic-segment context: `PATCH(req, routeContext({ id: "x" }))`. */
export function routeContext<P>(params: P): { params: Promise<P> } {
	return { params: Promise.resolve(params) };
}
