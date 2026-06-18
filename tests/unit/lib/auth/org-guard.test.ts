import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: h.getCurrentUser }));

vi.mock("next/server", () => ({
	NextResponse: {
		json: vi.fn((body: unknown, init?: { status?: number }) => ({ body, status: init?.status })),
	},
}));

import { guardOrgAdmin, guardOrgOwner, guardOrgUser } from "@/lib/auth/org-guard";

const env = {} as CloudflareEnv;

beforeEach(() => {
	vi.clearAllMocks();
	h.getCurrentUser.mockReset();
});

describe("guardOrgAdmin", () => {
	it("401 when there is no user", async () => {
		h.getCurrentUser.mockResolvedValue(null);
		const r = await guardOrgAdmin(env);
		expect(r.orgUser).toBeNull();
		expect(r.errorResponse).toEqual({ body: { error: "Unauthorized" }, status: 401 });
	});

	it("401 when the user has no organization", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: null, role: "owner" });
		const r = await guardOrgAdmin(env);
		expect(r.errorResponse).toEqual({ body: { error: "Unauthorized" }, status: 401 });
	});

	it("403 when the user has no role", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1", role: null });
		const r = await guardOrgAdmin(env);
		expect(r.errorResponse).toEqual({ body: { error: "Forbidden" }, status: 403 });
	});

	it("403 when the role is neither owner nor admin", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1", role: "member" });
		const r = await guardOrgAdmin(env);
		expect(r.errorResponse).toEqual({ body: { error: "Forbidden" }, status: 403 });
	});

	it("allows an owner", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1", role: "owner" });
		const r = await guardOrgAdmin(env);
		expect(r.errorResponse).toBeNull();
		expect(r.orgUser).toMatchObject({ id: "u1", organizationId: "org_1", role: "owner" });
	});

	it("allows an admin", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1", role: "admin" });
		const r = await guardOrgAdmin(env);
		expect(r.errorResponse).toBeNull();
		expect(r.orgUser).toMatchObject({ role: "admin" });
	});
});

describe("guardOrgOwner", () => {
	it("401 when there is no user", async () => {
		h.getCurrentUser.mockResolvedValue(null);
		const r = await guardOrgOwner(env);
		expect(r.errorResponse).toEqual({ body: { error: "Unauthorized" }, status: 401 });
	});

	it("401 when the user has no organization", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: null, role: "owner" });
		const r = await guardOrgOwner(env);
		expect(r.errorResponse).toEqual({ body: { error: "Unauthorized" }, status: 401 });
	});

	it("403 when the role is not owner", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1", role: "admin" });
		const r = await guardOrgOwner(env);
		expect(r.errorResponse).toEqual({ body: { error: "Forbidden" }, status: 403 });
	});

	it("allows an owner", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1", role: "owner" });
		const r = await guardOrgOwner(env);
		expect(r.errorResponse).toBeNull();
		expect(r.orgUser).toMatchObject({ role: "owner" });
	});
});

describe("guardOrgUser", () => {
	it("401 when there is no user", async () => {
		h.getCurrentUser.mockResolvedValue(null);
		const r = await guardOrgUser(env);
		expect(r.errorResponse).toEqual({ body: { error: "Unauthorized" }, status: 401 });
	});

	it("401 when the user has no organization", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: null, role: "member" });
		const r = await guardOrgUser(env);
		expect(r.errorResponse).toEqual({ body: { error: "Unauthorized" }, status: 401 });
	});

	it("403 when the user has no role", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1", role: null });
		const r = await guardOrgUser(env);
		expect(r.errorResponse).toEqual({ body: { error: "Forbidden" }, status: 403 });
	});

	it("allows any role member", async () => {
		h.getCurrentUser.mockResolvedValue({ id: "u1", organizationId: "org_1", role: "member" });
		const r = await guardOrgUser(env);
		expect(r.errorResponse).toBeNull();
		expect(r.orgUser).toMatchObject({ role: "member" });
	});
});
