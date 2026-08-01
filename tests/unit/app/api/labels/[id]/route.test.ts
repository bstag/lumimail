import { beforeEach, describe, expect, it, vi } from "vitest";

const m = await vi.hoisted(async () => {
	const { createRouteMocks } = await import("../../../../helpers/route-mocks");
	return createRouteMocks();
});
vi.mock("@/lib/cloudflare", () => m.cloudflareModule());
vi.mock("@/db", () => m.dbModule());
vi.mock("@/lib/auth/cookies", () => m.cookiesModule());

import { PATCH, DELETE } from "@/app/api/labels/[id]/route";
import { jsonRequest, routeContext } from "../../../../helpers/route-mocks";

const params = (id = "lbl_1") => routeContext({ id });

beforeEach(() => m.reset());

function req(body?: unknown, raw?: string) {
	return jsonRequest("https://x.test/api/labels/lbl_1", body, {
		method: "PATCH",
		...(raw !== undefined ? { rawBody: raw } : {}),
	});
}

describe("PATCH /api/labels/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await PATCH(req({ name: "X" }), params());
		expect(res.status).toBe(401);
	});

	it("returns 400 for invalid JSON", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await PATCH(req(undefined, "bad"), params());
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toEqual({ success: false, error: { message: "Invalid JSON" } });
	});

	it("returns 400 for an invalid body", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		const res = await PATCH(req({ color: "nothex" }), params());
		expect(res.status).toBe(400);
	});

	it("returns 404 when the label is missing or not owned", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([]); // .get() -> undefined
		const res = await PATCH(req({ name: "New" }), params());
		expect(res.status).toBe(404);
		expect(m.dbMock.updates).toHaveLength(0);
	});

	it("trims the updated name (shared updateLabelSchema)", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", userId: "u1" }]);
		m.dbMock.queueSelect([{ id: "lbl_1", name: "New" }]);
		const res = await PATCH(req({ name: "  New  " }), params());
		expect(res.status).toBe(200);
		expect(m.dbMock.updates[0].set).toEqual({ name: "New" });
	});

	it("updates an existing label", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", userId: "u1" }]); // existing
		m.dbMock.queueSelect([{ id: "lbl_1", name: "New" }]); // updated returning
		const res = await PATCH(req({ name: "New" }), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { id: "lbl_1", name: "New" } });
		expect(m.dbMock.updates[0].set).toEqual({ name: "New" });
	});

	// F75 parent rules. Lookup order in the handler: existing, parent, child.
	it("nests a label under a top-level parent", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", userId: "u1" }]); // existing
		m.dbMock.queueSelect([{ id: "lbl_top", parentId: null }]); // parent
		m.dbMock.queueSelect([]); // no children of its own
		m.dbMock.queueSelect([{ id: "lbl_1", parentId: "lbl_top" }]); // returning
		const res = await PATCH(req({ parentId: "lbl_top" }), params());
		expect(res.status).toBe(200);
		expect(m.dbMock.updates[0].set).toEqual({ parentId: "lbl_top" });
	});

	it("returns 404 for a parent that does not exist or is not the caller's", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", userId: "u1" }]); // existing
		m.dbMock.queueSelect([]); // parent lookup finds nothing
		m.dbMock.queueSelect([]); // no children
		const res = await PATCH(req({ parentId: "lbl_someone_else" }), params());
		expect(res.status).toBe(404);
		expect(m.dbMock.updates).toHaveLength(0);
	});

	it("rejects a label as its own parent", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", userId: "u1" }]);
		m.dbMock.queueSelect([{ id: "lbl_1", parentId: null }]);
		m.dbMock.queueSelect([]);
		const res = await PATCH(req({ parentId: "lbl_1" }), params());
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).error.message).toBe("A label cannot be its own parent");
		expect(m.dbMock.updates).toHaveLength(0);
	});

	it("rejects giving a parent to a label that has children", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", userId: "u1" }]);
		m.dbMock.queueSelect([{ id: "lbl_top", parentId: null }]);
		m.dbMock.queueSelect([{ id: "lbl_child" }]); // lbl_1 is itself a parent
		const res = await PATCH(req({ parentId: "lbl_top" }), params());
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).error.message).toBe("Move this label's children first");
		expect(m.dbMock.updates).toHaveLength(0);
	});

	it("promotes a label to top level without any parent lookups", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", userId: "u1" }]); // existing
		m.dbMock.queueSelect([{ id: "lbl_1", parentId: null }]); // returning
		const res = await PATCH(req({ parentId: null }), params());
		expect(res.status).toBe(200);
		expect(m.dbMock.updates[0].set).toEqual({ parentId: null });
	});
});

describe("DELETE /api/labels/[id]", () => {
	it("returns 401 when unauthenticated", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(401);
	});

	it("returns 404 when the label is missing or not owned", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([]); // .get() -> undefined
		const res = await DELETE(req(), params());
		expect(res.status).toBe(404);
		expect(m.dbMock.deletes).toHaveLength(0);
	});

	it("deletes an existing label", async () => {
		m.getCurrentUser.mockResolvedValue({ id: "u1" });
		m.dbMock.queueSelect([{ id: "lbl_1", userId: "u1" }]);
		const res = await DELETE(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ success: true, data: { id: "lbl_1" } });
		expect(m.dbMock.deletes.length).toBe(1);
	});
});
