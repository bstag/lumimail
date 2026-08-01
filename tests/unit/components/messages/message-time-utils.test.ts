import { describe, expect, it } from "vitest";
import { formatMessageListTime } from "@/components/messages/message-time-utils";

/**
 * Dates are built from local components rather than ISO strings on purpose: the
 * formatter renders in the viewer's timezone (what a mail client should do), so
 * a UTC-midnight fixture would land on the previous day west of Greenwich and
 * make these tests pass or fail by runner location.
 */
const now = new Date(2026, 6, 31, 20, 0); // 2026-07-31 20:00 local

describe("formatMessageListTime", () => {
	it("shows the clock time for today", () => {
		// Same-day mail is scanned by time of day, not by date.
		expect(formatMessageListTime(new Date(2026, 6, 31, 15, 24), now)).toBe("3:24 PM");
	});

	it("shows month and day within the same year", () => {
		expect(formatMessageListTime(new Date(2026, 6, 30, 9, 2), now)).toBe("Jul 30");
		expect(formatMessageListTime(new Date(2026, 0, 14, 11, 15), now)).toBe("Jan 14");
	});

	it("shows a numeric date for other years", () => {
		// A year label would not fit the column, so older mail drops to digits.
		expect(formatMessageListTime(new Date(2025, 11, 31, 23, 59), now)).toBe("12/31/25");
		expect(formatMessageListTime(new Date(2024, 2, 2, 12, 0), now)).toBe("3/2/24");
	});

	it("accepts the ISO strings the API actually returns", () => {
		expect(formatMessageListTime(new Date(2026, 6, 30, 9, 2).toISOString(), now)).toBe("Jul 30");
	});

	it("returns an empty string rather than 'Invalid Date' for unusable input", () => {
		expect(formatMessageListTime("not a date", now)).toBe("");
		expect(formatMessageListTime("", now)).toBe("");
	});

	it("treats a future same-day timestamp as today", () => {
		// Clock skew between the worker and the browser must not print a date.
		expect(formatMessageListTime(new Date(2026, 6, 31, 23, 30), now)).toBe("11:30 PM");
	});
});
