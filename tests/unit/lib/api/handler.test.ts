import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const m = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	guardOrgAdmin: vi.fn(),
	guardOrgOwner: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({ marker: "env" }) }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/auth/org-guard", () => ({
	guardOrgAdmin: m.guardOrgAdmin,
	guardOrgOwner: m.guardOrgOwner,
}));

import { withOrgAdmin, withOrgOwner, withUser } from "@/lib/api/handler";

const request = new Request("https://x.test/api/thing");
const user = { id: "u1", email: "u@x.test", organizationId: "org_1", role: "owner" };

beforeEach(() => {
	m.getCurrentUser.mockReset();
	m.guardOrgAdmin.mockReset();
	m.guardOrgOwner.mockReset();
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("withUser", () => {
	it("returns an enveloped 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const handler = vi.fn();
		const res = await withUser(handler)(request);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ success: false, error: { message: "Unauthorized" } });
		expect(handler).not.toHaveBeenCalled();
	});

	it("passes env, user, request, and awaited params to the handler", async () => {
		m.getCurrentUser.mockResolvedValue(user);
		const handler = vi.fn(async ({ params }: { params: { id: string } }) =>
			NextResponse.json({ id: params.id }),
		);
		const res = await withUser<{ id: string }>(handler)(request, {
			params: Promise.resolve({ id: "abc" }),
		});
		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledWith({
			request,
			env: { marker: "env" },
			user,
			params: { id: "abc" },
		});
	});

	it("defaults params to an empty object for static routes", async () => {
		m.getCurrentUser.mockResolvedValue(user);
		const handler = vi.fn(async () => NextResponse.json({ ok: true }));
		await withUser(handler)(request);
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ params: {} }),
		);
	});
});

describe("withOrgAdmin", () => {
	it("re-shapes a guard 401 into the envelope", async () => {
		m.guardOrgAdmin.mockResolvedValue({
			orgUser: null,
			errorResponse: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
		});
		const res = await withOrgAdmin(vi.fn())(request);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ success: false, error: { message: "Unauthorized" } });
	});

	it("re-shapes a guard 403 into the envelope", async () => {
		m.guardOrgAdmin.mockResolvedValue({
			orgUser: null,
			errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
		});
		const res = await withOrgAdmin(vi.fn())(request);
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ success: false, error: { message: "Forbidden" } });
	});

	it("passes the narrowed org user through on success", async () => {
		m.guardOrgAdmin.mockResolvedValue({ orgUser: user, errorResponse: null });
		const handler = vi.fn(async () => NextResponse.json({ ok: true }));
		const res = await withOrgAdmin(handler)(request, { params: Promise.resolve({}) });
		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledWith({
			request,
			env: { marker: "env" },
			user,
			params: {},
		});
	});
});

describe("withOrgOwner", () => {
	it("uses the owner guard", async () => {
		m.guardOrgOwner.mockResolvedValue({ orgUser: user, errorResponse: null });
		const handler = vi.fn(async () => NextResponse.json({ ok: true }));
		const res = await withOrgOwner(handler)(request);
		expect(res.status).toBe(200);
		expect(m.guardOrgOwner).toHaveBeenCalled();
		expect(m.guardOrgAdmin).not.toHaveBeenCalled();
	});
});
