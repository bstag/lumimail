import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: h.sendNotification } }));

import { sendPrivatePush } from "@/lib/push/provider";

const device = {
	endpoint: "https://fcm.googleapis.com/fcm/send/token",
	p256dh: "public-key",
	auth: "auth-secret",
};
const configured = {
	VAPID_PUBLIC_KEY: "public-vapid",
	VAPID_PRIVATE_KEY: "private-vapid",
	VAPID_SUBJECT: "mailto:operator@example.com",
};

describe("private Web Push provider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.sendNotification.mockResolvedValue({ statusCode: 201, body: "provider-body" });
	});

	it("sends only one opaque delivery ID with bounded delivery options", async () => {
		await expect(sendPrivatePush(configured, device, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK",
			topic: "pue_0123456789ABCDEFGHIJK",
		})).resolves.toEqual({ outcome: "delivered" });
		expect(h.sendNotification).toHaveBeenCalledWith({
			endpoint: device.endpoint,
			keys: { p256dh: "public-key", auth: "auth-secret" },
		}, JSON.stringify({ notificationId: "pudl_0123456789ABCDEFGHIJK" }), {
			TTL: 300,
			urgency: "normal",
			contentEncoding: "aes128gcm",
			timeout: 10_000,
			topic: "pue_0123456789ABCDEFGHIJK",
			vapidDetails: {
				subject: "mailto:operator@example.com",
				publicKey: "public-vapid",
				privateKey: "private-vapid",
			},
		});
		expect(h.sendNotification.mock.calls[0][1]).not.toMatch(/subject|sender|snippet|mailbox|messageId/i);
	});

	it("fails closed before provider I/O when VAPID configuration is incomplete", async () => {
		await expect(sendPrivatePush({}, device, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", topic: "pue_0123456789ABCDEFGHIJK",
		})).resolves.toEqual({ outcome: "retry", reason: "configuration" });
		await expect(sendPrivatePush({ ...configured, VAPID_SUBJECT: "not-a-subject" }, device, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", topic: "pue_0123456789ABCDEFGHIJK",
		})).resolves.toEqual({ outcome: "retry", reason: "configuration" });
		await expect(sendPrivatePush({ ...configured, VAPID_SUBJECT: undefined }, device, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", topic: "pue_0123456789ABCDEFGHIJK",
		})).resolves.toEqual({ outcome: "retry", reason: "configuration" });
		expect(h.sendNotification).not.toHaveBeenCalled();
	});

	it("accepts an HTTPS VAPID subject", async () => {
		await expect(sendPrivatePush({ ...configured, VAPID_SUBJECT: "https://example.com/push" }, device, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", topic: "pue_0123456789ABCDEFGHIJK",
		})).resolves.toEqual({ outcome: "delivered" });
	});

	it.each([
		[404, { outcome: "expired" }],
		[410, { outcome: "expired" }],
		[429, { outcome: "retry", reason: "provider" }],
		[500, { outcome: "retry", reason: "provider" }],
		[503, { outcome: "retry", reason: "provider" }],
		[400, { outcome: "failed" }],
	] as const)("classifies provider status %i without returning its body", async (statusCode, expected) => {
		h.sendNotification.mockRejectedValue({ statusCode, body: "sensitive provider diagnostic" });
		const result = await sendPrivatePush(configured, device, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", topic: "pue_0123456789ABCDEFGHIJK",
		});
		expect(result).toEqual(expected);
		expect(JSON.stringify(result)).not.toContain("sensitive");
	});

	it("treats network and timeout failures as retryable", async () => {
		h.sendNotification.mockRejectedValue(new TypeError("network down"));
		await expect(sendPrivatePush(configured, device, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", topic: "pue_0123456789ABCDEFGHIJK",
		})).resolves.toEqual({ outcome: "retry", reason: "network" });

		h.sendNotification.mockRejectedValue({ statusCode: 500.5 });
		await expect(sendPrivatePush(configured, device, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", topic: "pue_0123456789ABCDEFGHIJK",
		})).resolves.toEqual({ outcome: "retry", reason: "network" });

		h.sendNotification.mockRejectedValue("network down");
		await expect(sendPrivatePush(configured, device, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", topic: "pue_0123456789ABCDEFGHIJK",
		})).resolves.toEqual({ outcome: "retry", reason: "network" });
	});
});
