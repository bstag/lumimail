import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown, send: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/push/provider", () => ({ sendPrivatePush: h.send }));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => `${prefix ?? "id"}_fixed` }));

import {
	processPushQueueMessage,
	reconcilePushNotifications,
} from "@/lib/push/queue";

const now = new Date("2026-08-14T20:00:00.000Z");
const queueSend = vi.fn(async () => undefined);
const env = () => ({
	PUSH_QUEUE: { send: queueSend },
	VAPID_PUBLIC_KEY: "public",
	VAPID_PRIVATE_KEY: "private",
	VAPID_SUBJECT: "mailto:operator@example.com",
} as unknown as CloudflareEnv);

const event = {
	id: "pue_0123456789ABCDEFGHIJK",
	organizationId: "org_1",
	mailboxId: "mbx_1",
	messageId: "msg_1",
	status: "pending",
	expansionCursor: null,
	direction: "inbound",
	messageStatus: "received",
	read: false,
};

const delivery = {
	id: "pudl_0123456789ABCDEFGHIJK",
	eventId: event.id,
	deviceId: "pud_1",
	status: "pending",
	attempts: 0,
	nextAttemptAt: new Date(now.getTime() - 1),
};

const eligible = {
	deliveryId: delivery.id,
	eventId: event.id,
	deviceId: "pud_1",
	endpoint: "https://fcm.googleapis.com/fcm/send/token",
	p256dh: "public-key",
	auth: "auth-secret",
	deviceStatus: "active",
	deviceUserId: "usr_1",
	deviceOrganizationId: "org_1",
	approvingSessionId: "sess_1",
	sessionUserId: "usr_1",
	sessionOrganizationId: "org_1",
	sessionExpiresAt: new Date(now.getTime() + 60_000),
	preferenceDeviceId: "pud_1",
	preferenceMailboxId: "mbx_1",
	membershipUserId: "usr_1",
	membershipMailboxId: "mbx_1",
	membershipRole: "viewer",
	eventOrganizationId: "org_1",
	eventMailboxId: "mbx_1",
	eventMessageId: "msg_1",
	messageOrganizationId: "org_1",
	messageMailboxId: "mbx_1",
	direction: "inbound",
	messageStatus: "received",
	read: false,
};

describe("push queue", () => {
	let mock: ReturnType<typeof createDbMock>;

	beforeEach(() => {
		vi.clearAllMocks();
		mock = createDbMock();
		h.db = mock.db;
		h.send.mockResolvedValue({ outcome: "delivered" });
	});

	it("terminalizes an event whose message is no longer unread inbox mail", async () => {
		mock.queueSelect([{ id: event.id }]); // lease
		mock.queueSelect([{ ...event, read: true }]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-expand", version: 1, eventId: event.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(queueSend).not.toHaveBeenCalled();
		expect(mock.updates.at(-1)?.set).toMatchObject({ status: "complete", completedAt: now });
	});

	it("acknowledges an event when another worker owns its lease", async () => {
		mock.queueSelect([]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-expand", version: 1, eventId: event.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("completes an event with no eligible devices", async () => {
		mock.queueSelect([{ id: event.id }]);
		mock.queueSelect([{ ...event, expansionCursor: "pud_previous" }]);
		mock.queueSelect([]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-expand", version: 1, eventId: event.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(queueSend).not.toHaveBeenCalled();
		expect(mock.updates.at(-1)?.set).toMatchObject({
			status: "complete", expansionCursor: "pud_previous",
		});
	});

	it("pages fifty devices and leaves failed queue wakeups for reconciliation", async () => {
		const devices = Array.from({ length: 50 }, (_, index) => ({ id: `pud_${index.toString().padStart(2, "0")}` }));
		mock.queueSelect([{ id: event.id }]);
		mock.queueSelect([{ ...event, expansionCursor: "pud_cursor" }]);
		mock.queueSelect(devices);
		mock.queueSelect(devices.map((device) => ({ id: `pudl_${device.id}`, deviceId: device.id })));
		queueSend.mockRejectedValue(new Error("queue unavailable"));

		await expect(processPushQueueMessage(env(), {
			kind: "push-expand", version: 1, eventId: event.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(queueSend).toHaveBeenCalledTimes(51);
		expect(mock.updates.at(-1)?.set).toMatchObject({
			status: "pending", expansionCursor: "pud_49", nextAttemptAt: now,
		});
	});

	it("expands eligible devices idempotently into opaque delivery jobs", async () => {
		mock.queueSelect([{ id: event.id }]); // lease
		mock.queueSelect([event]);
		mock.queueSelect([{ id: "pud_1" }]);
		mock.queueSelect([]); // no existing delivery

		await expect(processPushQueueMessage(env(), {
			kind: "push-expand", version: 1, eventId: event.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(mock.inserts[0].values).toMatchObject({
			id: "pudl_fixed", eventId: event.id, deviceId: "pud_1", status: "pending",
		});
		expect(queueSend).toHaveBeenCalledWith({
			kind: "push-deliver", version: 1, deliveryId: "pudl_fixed",
		});
		expect(mock.updates.at(-1)?.set).toMatchObject({ status: "complete", completedAt: now });
	});

	it("reuses an existing event/device delivery instead of creating a duplicate", async () => {
		mock.queueSelect([{ id: event.id }]);
		mock.queueSelect([event]);
		mock.queueSelect([{ id: "pud_1" }]);
		mock.queueSelect([{ id: "pudl_existing", deviceId: "pud_1" }]);
		await processPushQueueMessage(env(), { kind: "push-expand", version: 1, eventId: event.id }, now);
		expect(mock.inserts).toHaveLength(0);
		expect(queueSend).toHaveBeenCalledWith({
			kind: "push-deliver", version: 1, deliveryId: "pudl_existing",
		});
	});

	it("rechecks every live authorization and message invariant before provider I/O", async () => {
		mock.queueSelect([delivery]);
		mock.queueSelect([{ id: delivery.id }]); // lease
		mock.queueSelect([{ ...eligible, sessionExpiresAt: new Date(now.getTime() - 1) }]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-deliver", version: 1, deliveryId: delivery.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(h.send).not.toHaveBeenCalled();
		expect(mock.updates.at(-1)?.set).toMatchObject({ status: "skipped", providerOutcome: "authorization_revoked" });
	});

	it.each([
		["inactive device", { deviceStatus: "revoked" }],
		["session user", { sessionUserId: "usr_other" }],
		["session organization", { sessionOrganizationId: "org_other" }],
		["event organization", { eventOrganizationId: "org_other" }],
		["message organization", { messageOrganizationId: "org_other" }],
		["approving session", { approvingSessionId: "" }],
		["expired session", { sessionExpiresAt: new Date(now.getTime() - 1) }],
		["device preference", { preferenceDeviceId: "pud_other" }],
		["mailbox preference", { preferenceMailboxId: "mbx_other" }],
		["membership user", { membershipUserId: "usr_other" }],
		["membership mailbox", { membershipMailboxId: "mbx_other" }],
		["read capability", { membershipRole: "owner" }],
		["message mailbox", { messageMailboxId: "mbx_other" }],
		["event message", { eventMessageId: "" }],
		["inbound direction", { direction: "outbound" }],
		["received state", { messageStatus: "draft" }],
		["unread state", { read: true }],
	] as const)("skips delivery when the %s invariant is revoked", async (_label, change) => {
		mock.queueSelect([delivery]);
		mock.queueSelect([{ id: delivery.id }]);
		mock.queueSelect([{ ...eligible, ...change }]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-deliver", version: 1, deliveryId: delivery.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(h.send).not.toHaveBeenCalled();
	});

	it.each([
		[undefined, new Date(now.getTime() - 1)],
		["delivered", new Date(now.getTime() - 1)],
		["pending", new Date(now.getTime() + 1)],
	] as const)("acknowledges a missing, non-pending, or future delivery", async (status, nextAttemptAt) => {
		mock.queueSelect(status ? [{ ...delivery, status, nextAttemptAt }] : []);
		await expect(processPushQueueMessage(env(), {
			kind: "push-deliver", version: 1, deliveryId: delivery.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(h.send).not.toHaveBeenCalled();
	});

	it("acknowledges a delivery when another worker wins its lease", async () => {
		mock.queueSelect([delivery]);
		mock.queueSelect([]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-deliver", version: 1, deliveryId: delivery.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(h.send).not.toHaveBeenCalled();
	});

	it("delivers with only stored credentials and opaque IDs", async () => {
		mock.queueSelect([delivery]);
		mock.queueSelect([{ id: delivery.id }]);
		mock.queueSelect([eligible]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-deliver", version: 1, deliveryId: delivery.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(h.send).toHaveBeenCalledWith(env(), {
			endpoint: eligible.endpoint, p256dh: eligible.p256dh, auth: eligible.auth,
		}, { deliveryId: delivery.id, topic: event.id });
		expect(mock.db.batch).toHaveBeenCalledOnce();
		expect(mock.updates.at(-2)?.set).toMatchObject({ status: "delivered", deliveredAt: now });
	});

	it("expires dead subscriptions and removes their pending preferences", async () => {
		h.send.mockResolvedValue({ outcome: "expired" });
		mock.queueSelect([delivery]);
		mock.queueSelect([{ id: delivery.id }]);
		mock.queueSelect([eligible]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-deliver", version: 1, deliveryId: delivery.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(mock.updates.some((update) => (update.set as any).status === "expired")).toBe(true);
		expect(mock.deletes).toHaveLength(1);
	});

	it("terminalizes a permanent provider rejection", async () => {
		h.send.mockResolvedValue({ outcome: "failed" });
		mock.queueSelect([delivery]);
		mock.queueSelect([{ id: delivery.id }]);
		mock.queueSelect([eligible]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-deliver", version: 1, deliveryId: delivery.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(mock.updates.at(-1)?.set).toMatchObject({
			status: "failed", attempts: 1, providerOutcome: "provider_rejected",
		});
	});

	it("retries at fixed delays and terminalizes the third provider attempt", async () => {
		h.send.mockResolvedValue({ outcome: "retry", reason: "provider" });
		for (const [attempts, expected] of [[0, 60], [1, 300]] as const) {
			mock = createDbMock(); h.db = mock.db;
			mock.queueSelect([{ ...delivery, attempts }]);
			mock.queueSelect([{ id: delivery.id }]);
			mock.queueSelect([eligible]);
			await expect(processPushQueueMessage(env(), {
				kind: "push-deliver", version: 1, deliveryId: delivery.id,
			}, now)).resolves.toEqual({ action: "retry", delaySeconds: expected });
			expect(mock.updates.at(-1)?.set).toMatchObject({ status: "pending", attempts: attempts + 1 });
		}

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([{ ...delivery, attempts: 2 }]);
		mock.queueSelect([{ id: delivery.id }]);
		mock.queueSelect([eligible]);
		await expect(processPushQueueMessage(env(), {
			kind: "push-deliver", version: 1, deliveryId: delivery.id,
		}, now)).resolves.toEqual({ action: "ack" });
		expect(mock.updates.at(-1)?.set).toMatchObject({ status: "failed", attempts: 3, providerOutcome: "retry_exhausted" });
	});

	it("reconciliation wakes at most 100 due opaque rows without exposing content", async () => {
		mock.queueSelect([{ id: "pue_1" }, { id: "pue_2" }]);
		mock.queueSelect([{ id: "pudl_1" }]);
		await expect(reconcilePushNotifications(env(), now)).resolves.toEqual({ events: 2, deliveries: 1 });
		expect(queueSend).toHaveBeenCalledTimes(3);
		expect(queueSend.mock.calls.flat().join(" ")).not.toMatch(/subject|sender|snippet|mailbox|message/i);
	});

	it("bounds reconciliation at 100 events and tolerates queue outages", async () => {
		mock.queueSelect(Array.from({ length: 100 }, (_, index) => ({ id: `pue_${index}` })));
		queueSend.mockRejectedValue(new Error("queue unavailable"));
		await expect(reconcilePushNotifications(env(), now)).resolves.toEqual({ events: 100, deliveries: 0 });
		expect(queueSend).toHaveBeenCalledTimes(100);
	});

	it("leaves failed delivery reconciliation for the next scheduled run", async () => {
		mock.queueSelect([]);
		mock.queueSelect([{ id: delivery.id }]);
		queueSend.mockRejectedValue(new Error("queue unavailable"));
		await expect(reconcilePushNotifications(env())).resolves.toEqual({ events: 0, deliveries: 1 });
	});
});
