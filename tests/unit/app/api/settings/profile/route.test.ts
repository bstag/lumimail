import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	guardUser: vi.fn(),
	parseUpdateProfileRequest: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ guardUser: m.guardUser }));
vi.mock("@/app/api/settings/profile/utils", () => ({
	parseUpdateProfileRequest: m.parseUpdateProfileRequest,
}));

import { PATCH } from "@/app/api/settings/profile/route";
import { ZodError } from "zod";

let mock: DbMock;
const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.guardUser.mockReset();
	m.parseUpdateProfileRequest.mockReset();
});

const req = () => new Request("https://x.test/api/settings/profile", { method: "PATCH" });

describe("PATCH /api/settings/profile", () => {
	it("returns 401 when unauthenticated", async () => {
		m.guardUser.mockResolvedValue({ errorResponse: unauth });
		const res = await PATCH(req());
		expect(res.status).toBe(401);
	});

	it("returns 400 with flattened issues on a ZodError", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", email: "u@x.test" } });
		const zerr = new ZodError([
			{ code: "custom", path: ["name"], message: "Required" },
		]);
		m.parseUpdateProfileRequest.mockRejectedValue(zerr);
		const res = await PATCH(req());
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.error.fieldErrors).toBeDefined();
	});

	it("returns 400 'Invalid request' on a non-Zod error", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", email: "u@x.test" } });
		m.parseUpdateProfileRequest.mockRejectedValue(new Error("boom"));
		const res = await PATCH(req());
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ error: "Invalid request" });
	});

	it("updates the profile and returns the user", async () => {
		m.guardUser.mockResolvedValue({ user: { id: "u1", email: "u@x.test" } });
		m.parseUpdateProfileRequest.mockResolvedValue({ name: "Jane", resetEmail: "r@x.test" });
		const res = await PATCH(req());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			user: { id: "u1", email: "u@x.test", name: "Jane", resetEmail: "r@x.test" },
		});
		expect(mock.updates[0].set).toMatchObject({ name: "Jane", resetEmail: "r@x.test" });
	});
});
