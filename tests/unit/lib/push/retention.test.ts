import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import { purgePushNotificationState } from "@/lib/push/retention";

describe("push state retention", () => {
	let mock: ReturnType<typeof createDbMock>;
	beforeEach(() => {
		mock = createDbMock();
		h.db = mock.db;
	});

	it("deletes only selected bounded terminal rows", async () => {
		mock.queueSelect([{ id: "pudl_old" }]);
		mock.queueSelect([{ id: "pue_old" }]);
		mock.queueSelect([{ id: "pud_old" }]);
		await expect(purgePushNotificationState({} as CloudflareEnv, new Date("2026-08-14T20:00:00Z")))
			.resolves.toEqual({ deliveries: 1, events: 1, devices: 1 });
		expect(mock.db.select).toHaveBeenCalledTimes(3);
		for (const selection of mock.db.select.mock.results) {
			expect(selection.value.limit).toHaveBeenCalledWith(100);
		}
		expect(mock.deletes).toHaveLength(3);
	});

	it("performs no broad delete when nothing is beyond retention", async () => {
		mock.queueSelect([]).queueSelect([]).queueSelect([]);
		await purgePushNotificationState({} as CloudflareEnv, new Date());
		expect(mock.deletes).toHaveLength(0);
	});
});
