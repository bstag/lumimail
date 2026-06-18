import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import { dispatchWebhooks } from "@/lib/email/webhooks";

const env = {} as CloudflareEnv;
let mock: DbMock;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	mock = createDbMock();
	h.db = mock.db;
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("dispatchWebhooks", () => {
	it("does nothing when there are no hooks", async () => {
		mock.queueSelect([]);
		await dispatchWebhooks(env, "u1", "message.inbound", { messageId: "m1" });
		expect(mock.inserts).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("skips disabled hooks", async () => {
		mock.queueSelect([
			{ id: "wh1", enabled: false, events: JSON.stringify(["message.inbound"]), url: "https://x", secret: "s" },
		]);
		await dispatchWebhooks(env, "u1", "message.inbound", {});
		expect(mock.inserts).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("skips hooks whose events JSON is invalid", async () => {
		mock.queueSelect([
			{ id: "wh1", enabled: true, events: "not-json", url: "https://x", secret: "s" },
		]);
		await dispatchWebhooks(env, "u1", "message.inbound", {});
		expect(mock.inserts).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("skips hooks not subscribed to the event type", async () => {
		mock.queueSelect([
			{ id: "wh1", enabled: true, events: JSON.stringify(["message.outbound"]), url: "https://x", secret: "s" },
		]);
		await dispatchWebhooks(env, "u1", "message.inbound", {});
		expect(mock.inserts).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("records a delivery and marks it delivered on a successful POST", async () => {
		mock.queueSelect([
			{ id: "wh1", enabled: true, events: JSON.stringify(["message.inbound"]), url: "https://hook.test", secret: "sekret" },
		]);
		fetchMock.mockResolvedValue({ ok: true } as Response);

		await dispatchWebhooks(env, "u1", "message.inbound", { messageId: "m1" });

		expect(mock.inserts).toHaveLength(1);
		expect(mock.inserts[0].values).toMatchObject({
			webhookId: "wh1",
			eventType: "message.inbound",
			payload: JSON.stringify({ type: "message.inbound", data: { messageId: "m1" } }),
			status: "pending",
			attempts: 0,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://hook.test");
		expect(init.method).toBe("POST");
		expect(init.headers["Content-Type"]).toBe("application/json");
		expect(init.headers["X-Email-Platform-Event"]).toBe("message.inbound");
		// HMAC-SHA256 hex signature: 64 hex chars
		expect(init.headers["X-Email-Platform-Signature"]).toMatch(/^[0-9a-f]{64}$/);

		expect(mock.updates).toHaveLength(1);
		expect(mock.updates[0].set).toEqual({ status: "delivered", attempts: 1 });
	});

	it("marks the delivery failed when the POST returns a non-ok response", async () => {
		mock.queueSelect([
			{ id: "wh1", enabled: true, events: JSON.stringify(["message.outbound"]), url: "https://hook.test", secret: "s" },
		]);
		fetchMock.mockResolvedValue({ ok: false } as Response);

		await dispatchWebhooks(env, "u1", "message.outbound", {});

		expect(mock.updates[0].set).toEqual({ status: "failed", attempts: 1 });
	});

	it("marks the delivery failed when fetch throws", async () => {
		mock.queueSelect([
			{ id: "wh1", enabled: true, events: JSON.stringify(["message.failed"]), url: "https://hook.test", secret: "s" },
		]);
		fetchMock.mockRejectedValue(new Error("network down"));

		await dispatchWebhooks(env, "u1", "message.failed", { error: "boom" });

		expect(mock.inserts).toHaveLength(1);
		expect(mock.updates).toHaveLength(1);
		expect(mock.updates[0].set).toEqual({ status: "failed", attempts: 1 });
	});

	it("processes multiple hooks independently", async () => {
		mock.queueSelect([
			{ id: "wh1", enabled: false, events: JSON.stringify(["message.inbound"]), url: "https://a", secret: "s" },
			{ id: "wh2", enabled: true, events: JSON.stringify(["message.inbound"]), url: "https://b", secret: "s" },
		]);
		fetchMock.mockResolvedValue({ ok: true } as Response);

		await dispatchWebhooks(env, "u1", "message.inbound", {});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe("https://b");
		expect(mock.inserts).toHaveLength(1);
		expect(mock.inserts[0].values).toMatchObject({ webhookId: "wh2" });
	});
});
