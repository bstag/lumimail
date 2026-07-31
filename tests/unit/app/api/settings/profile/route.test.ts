import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { PATCH } from "@/app/api/settings/profile/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset();
});

function req(body?: unknown, rawBody?: string) {
	return new Request("https://x.test/api/settings/profile", {
		method: "PATCH",
		body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("PATCH /api/settings/profile", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await PATCH(req({ name: "Jane", resetEmail: "" }));
		expect(res.status).toBe(401);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Unauthorized" } });
	});

	it("returns 400 with the first issue on an invalid body", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", email: "u@x.test" });
		const res = await PATCH(req({ name: "", resetEmail: "" }));
		expect(res.status).toBe(400);
		const body = (await res.json()) as any;
		expect(body.success).toBe(false);
		expect(body.error.message).toMatch(/^name: /);
	});

	it("returns 400 'Invalid JSON' on a malformed body", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", email: "u@x.test" });
		const res = await PATCH(req(undefined, "not json"));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Invalid JSON" } });
	});

	it("updates the profile and returns the user", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", email: "u@x.test" });
		const res = await PATCH(req({ name: " Jane ", resetEmail: " r@x.test " }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { user: { id: "u1", email: "u@x.test", name: "Jane", resetEmail: "r@x.test" } },
		});
		expect(mock.updates[0].set).toMatchObject({ name: "Jane", resetEmail: "r@x.test" });
	});

	it("stores a null resetEmail when cleared", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1", email: "u@x.test" });
		const res = await PATCH(req({ name: "Jane", resetEmail: "" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { user: { id: "u1", email: "u@x.test", name: "Jane", resetEmail: null } },
		});
		expect(mock.updates[0].set).toMatchObject({ name: "Jane", resetEmail: null });
	});
});
