import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getCurrentUser: vi.fn(), unsubscribe: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock("@/lib/categorization/sender-actions", () => ({ unsubscribeSender: m.unsubscribe, archiveSender: m.archive }));

import { POST as archive } from "@/app/api/insights/senders/archive/route";
import { POST as unsubscribe } from "@/app/api/insights/senders/unsubscribe/route";

const user = { id: "u1", organizationId: "org1" };
const post = (handler: typeof archive, body: unknown) =>
	handler(new Request("https://x.test/api/insights/senders", {
		method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
	}));

beforeEach(() => {
	vi.clearAllMocks();
	m.getCurrentUser.mockResolvedValue(user);
	m.unsubscribe.mockResolvedValue({ method: "link", url: "https://shop.example/u" });
	m.archive.mockResolvedValue({ archived: 3, filterId: "filter_1" });
});

describe("sender cleanup routes (F98)", () => {
	it("require a signed-in user", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		expect((await post(unsubscribe, { sender: "deals@shop.example" })).status).toBe(401);
		expect((await post(archive, { sender: "deals@shop.example" })).status).toBe(401);
		expect(m.unsubscribe).not.toHaveBeenCalled();
	});

	it("validate the sender", async () => {
		expect((await post(unsubscribe, { sender: "x" })).status).toBe(400);
		expect((await post(archive, "not json")).status).toBe(400);
		expect((await post(unsubscribe, "not json")).status).toBe(400);
	});

	it("unsubscribe for the signed-in user only", async () => {
		const res = await post(unsubscribe, { sender: " deals@shop.example ", mailboxId: "mbx_1" });
		expect(await res.json()).toEqual({ success: true, data: { method: "link", url: "https://shop.example/u" } });
		expect(m.unsubscribe).toHaveBeenCalledWith({}, user, { sender: "deals@shop.example", mailboxId: "mbx_1" });
	});

	it("archive and create the filter by default", async () => {
		const res = await post(archive, { sender: "deals@shop.example" });
		expect(await res.json()).toEqual({ success: true, data: { archived: 3, filterId: "filter_1" } });
		expect(m.archive).toHaveBeenCalledWith({}, user, { sender: "deals@shop.example", mailboxId: null, createFilter: true });
	});
});
