import { describe, expect, it } from "vitest";
import { isSnoozed, snoozeUntil } from "@/components/message-actions/snooze-utils";

const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe("snooze presets (F100)", () => {
	it("rounds later today to the hour, three hours out", () => {
		expect(snoozeUntil("later_today", local(2026, 11, 7, 14, 25))).toEqual(local(2026, 11, 7, 17));
		expect(snoozeUntil("later_today", local(2026, 11, 7, 22, 10))).toEqual(local(2026, 11, 8, 1));
	});

	it("wakes tomorrow at 8:00", () => {
		expect(snoozeUntil("tomorrow", local(2026, 11, 7, 23, 59))).toEqual(local(2026, 11, 8, 8));
	});

	it("wakes next Monday at 8:00, a full week out when today is Monday", () => {
		expect(snoozeUntil("next_week", local(2026, 11, 7, 9))).toEqual(local(2026, 11, 9, 8)); // Saturday → Monday
		expect(snoozeUntil("next_week", local(2026, 11, 9, 9))).toEqual(local(2026, 11, 16, 8)); // Monday → next Monday
		expect(snoozeUntil("next_week", local(2026, 11, 8, 9))).toEqual(local(2026, 11, 9, 8)); // Sunday → Monday
	});

	it("knows whether a stored wake time is still ahead", () => {
		const now = new Date("2026-11-07T12:00:00Z");
		expect(isSnoozed("2026-11-07T13:00:00Z", now)).toBe(true);
		expect(isSnoozed("2026-11-07T11:00:00Z", now)).toBe(false);
		expect(isSnoozed(null, now)).toBe(false);
		expect(isSnoozed(undefined, now)).toBe(false);
	});
});
