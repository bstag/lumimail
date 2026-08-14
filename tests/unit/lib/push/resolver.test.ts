import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import { resolvePushNotification } from "@/lib/push/resolver";

describe("push notification click resolver", () => {
	let mock: ReturnType<typeof createDbMock>;
	beforeEach(() => {
		mock = createDbMock();
		h.db = mock.db;
	});

	it("resolves an active owned delivery with current readable mailbox access", async () => {
		mock.queueSelect([{
			messageId: "msg_1",
			deviceStatus: "active",
			deviceUserId: "usr_1",
			deviceOrganizationId: "org_1",
			messageOrganizationId: "org_1",
			messageMailboxId: "mbx_1",
			messageStatus: "received",
			membershipUserId: "usr_1",
			membershipMailboxId: "mbx_1",
			membershipRole: "viewer",
		}]);
		await expect(resolvePushNotification({} as CloudflareEnv, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK",
			userId: "usr_1", organizationId: "org_1",
		})).resolves.toEqual({ messageId: "msg_1" });
	});

	it.each([
		{},
		{ deviceStatus: "revoked" },
		{ deviceUserId: "usr_other" },
		{ deviceOrganizationId: "org_other" },
		{ messageOrganizationId: "org_other" },
		{ messageMailboxId: "mbx_other" },
		{ messageStatus: "trash" },
		{ membershipUserId: "usr_other" },
		{ membershipMailboxId: "mbx_other" },
		{ membershipRole: "none" },
	])("returns the same absence for missing or revoked access %#", async (override) => {
		mock.queueSelect(Object.keys(override).length === 0 ? [] : [{
			messageId: "msg_1", deviceStatus: "active", deviceUserId: "usr_1",
			deviceOrganizationId: "org_1", messageOrganizationId: "org_1",
			messageMailboxId: "mbx_1", messageStatus: "received", membershipUserId: "usr_1",
			membershipMailboxId: "mbx_1", membershipRole: "viewer", ...override,
		}]);
		await expect(resolvePushNotification({} as CloudflareEnv, {
			deliveryId: "pudl_0123456789ABCDEFGHIJK", userId: "usr_1", organizationId: "org_1",
		})).resolves.toBeNull();
	});
});
