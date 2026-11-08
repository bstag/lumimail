export type SnoozePreset = "later_today" | "tomorrow" | "next_week";

/**
 * Wake times in the reader's local time (F100): three hours from now on the hour, tomorrow at
 * 08:00, and next Monday at 08:00 (a week ahead if today is Monday).
 */
export function snoozeUntil(preset: SnoozePreset, now: Date): Date {
	const wake = new Date(now);
	if (preset === "later_today") {
		wake.setHours(wake.getHours() + 3, 0, 0, 0);
		return wake;
	}
	wake.setHours(8, 0, 0, 0);
	if (preset === "tomorrow") {
		wake.setDate(wake.getDate() + 1);
		return wake;
	}
	const daysToMonday = ((8 - wake.getDay()) % 7) || 7;
	wake.setDate(wake.getDate() + daysToMonday);
	return wake;
}

/** A stored wake time that is still ahead, i.e. the message is currently snoozed. */
export function isSnoozed(snoozedUntil: string | null | undefined, now: Date): boolean {
	return !!snoozedUntil && new Date(snoozedUntil).getTime() > now.getTime();
}
