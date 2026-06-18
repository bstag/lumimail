import { describe, expect, it } from "vitest";
import {
	getReadValueForBulkAction,
	getStatusForBulkAction,
	isAllowedBulkMessageAction,
} from "@/app/api/messages/bulk/utils";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";

describe("isAllowedBulkMessageAction", () => {
	it("returns true for each allowed action", () => {
		for (const action of ["archive", "trash", "spam", "read", "unread", "inbox"]) {
			expect(isAllowedBulkMessageAction(action)).toBe(true);
		}
	});

	it("returns false for an unknown string", () => {
		expect(isAllowedBulkMessageAction("delete")).toBe(false);
		expect(isAllowedBulkMessageAction("")).toBe(false);
	});

	it("returns false for non-string values", () => {
		expect(isAllowedBulkMessageAction(undefined)).toBe(false);
		expect(isAllowedBulkMessageAction(null)).toBe(false);
		expect(isAllowedBulkMessageAction(7)).toBe(false);
	});
});

describe("getStatusForBulkAction", () => {
	it("maps status-changing actions to their target status", () => {
		expect(getStatusForBulkAction("archive")).toBe("archived");
		expect(getStatusForBulkAction("trash")).toBe("trash");
		expect(getStatusForBulkAction("spam")).toBe("spam");
		expect(getStatusForBulkAction("inbox")).toBe("received");
	});

	it("returns null for read/unread actions", () => {
		expect(getStatusForBulkAction("read")).toBeNull();
		expect(getStatusForBulkAction("unread")).toBeNull();
	});
});

describe("getReadValueForBulkAction", () => {
	it("maps read to true and unread to false", () => {
		expect(getReadValueForBulkAction("read")).toBe(true);
		expect(getReadValueForBulkAction("unread")).toBe(false);
	});

	it("returns null for non-read actions", () => {
		for (const action of ["archive", "trash", "spam", "inbox"] as BulkMessageAction[]) {
			expect(getReadValueForBulkAction(action)).toBeNull();
		}
	});
});
