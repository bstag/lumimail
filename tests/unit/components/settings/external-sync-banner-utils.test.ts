import { describe, expect, it } from "vitest";
import {
	describeSyncBanners,
	type SyncBannerAccount,
} from "@/components/settings/external-sync-banner-utils";

const NOW = new Date("2026-10-01T12:00:00Z");
const format = (date: Date) => `T${date.getUTCHours()}`;

const account = (fields: Partial<SyncBannerAccount> = {}): SyncBannerAccount => ({
	id: "exa_1", provider: "google", externalAddress: "owner@gmail.com", ownerUserId: "usr_1",
	status: "active", nextRetryAt: null, autoRetryExhausted: false, skippedMessageCount: 0, ...fields,
});

const describeAll = (accounts: SyncBannerAccount[], userId = "usr_1") =>
	describeSyncBanners(accounts, userId, NOW, format);

describe("sync banners", () => {
	it("shows nothing for healthy, paused, importing, or disconnected accounts", () => {
		expect(describeAll([
			account({ status: "active" }), account({ id: "b", status: "paused" }),
			account({ id: "c", status: "initial_sync" }), account({ id: "d", status: "connecting" }),
			account({ id: "e", status: "disconnected" }),
		])).toEqual([]);
	});

	it("asks the owner to reconnect when access was lost, naming the provider", () => {
		expect(describeAll([account({ status: "reconnect_required" })])).toEqual([{
			key: "exa_1:reconnect", tone: "danger",
			message: "Reconnect owner@gmail.com: Google could not confirm your access, so new mail is not syncing.",
		}]);
		expect(describeAll([account({ provider: "microsoft", status: "reconnect_required" })])[0].message)
			.toContain("Microsoft could not confirm");
	});

	it("tells the owner when an automatic retry is scheduled, in progress, or spent", () => {
		expect(describeAll([account({ status: "error", nextRetryAt: "2026-10-01T12:30:00Z" })])).toEqual([{
			key: "exa_1:retry", tone: "warning",
			message: "Sync for owner@gmail.com hit a problem. Retrying automatically at T12.",
		}]);
		expect(describeAll([account({ status: "resync_required", nextRetryAt: null })])).toEqual([{
			key: "exa_1:retry", tone: "warning",
			message: "Sync for owner@gmail.com hit a problem and is retrying now.",
		}]);
		expect(describeAll([account({ status: "error", nextRetryAt: "2026-10-01T11:00:00Z" })])[0].message)
			.toContain("is retrying now");
		expect(describeAll([account({ status: "error", autoRetryExhausted: true })])).toEqual([{
			key: "exa_1:stopped", tone: "danger",
			message: "Sync for owner@gmail.com stopped after repeated problems. Retry it from External accounts.",
		}]);
	});

	it("reports skipped messages with correct singular and plural wording", () => {
		expect(describeAll([account({ skippedMessageCount: 1 })])).toEqual([{
			key: "exa_1:skipped", tone: "info",
			message: "1 message from owner@gmail.com could not be imported (too large or repeatedly failing).",
		}]);
		expect(describeAll([account({ skippedMessageCount: 4 })])[0].message)
			.toBe("4 messages from owner@gmail.com could not be imported (too large or repeatedly failing).");
		expect(describeAll([account({ skippedMessageCount: undefined })])).toEqual([]);
	});

	it("orders the most urgent first and can show two notices for one account", () => {
		const banners = describeAll([
			account({ id: "a", skippedMessageCount: 2 }),
			account({ id: "b", status: "error", nextRetryAt: "2026-10-01T12:30:00Z", skippedMessageCount: 1 }),
			account({ id: "c", status: "reconnect_required" }),
		]);
		expect(banners.map((banner) => `${banner.tone}:${banner.key}`)).toEqual([
			"danger:c:reconnect", "warning:b:retry", "info:a:skipped", "info:b:skipped",
		]);
	});

	it("ignores accounts the signed-in user does not own", () => {
		expect(describeAll([account({ ownerUserId: "usr_other", status: "reconnect_required" })])).toEqual([]);
		expect(describeAll([account({ status: "reconnect_required" })], "usr_other")).toEqual([]);
	});

	it("formats the retry time for the viewer's locale by default", () => {
		const [banner] = describeSyncBanners(
			[account({ status: "error", nextRetryAt: "2026-10-01T12:30:00Z" })], "usr_1", NOW,
		);
		expect(banner.message).toMatch(/^Sync for owner@gmail\.com hit a problem\. Retrying automatically at .+\.$/);
	});
});
