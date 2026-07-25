import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

import {
	AUTO_REPLY_HEADERS,
	VACATION_REPLY_WINDOW_DAYS,
	isVacationAudienceAllowed,
	shouldSuppressVacationReply,
	withinVacationReplyWindow,
} from "@/lib/email/vacation";

let mock: DbMock;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
});

function suppress(options: {
	from?: string;
	to?: string;
	headers?: Record<string, string>;
}) {
	return shouldSuppressVacationReply({
		fromAddr: options.from ?? "correspondent@example.net",
		toAddr: options.to ?? "owner@example.com",
		headers: options.headers ?? {},
	});
}

describe("shouldSuppressVacationReply", () => {
	it("allows an ordinary human correspondent", () => {
		expect(suppress({})).toBeNull();
	});

	it("suppresses a bounce, which has no envelope sender", () => {
		expect(suppress({ from: "" })).toBe("null_sender");
		expect(suppress({ from: "<>" })).toBe("null_sender");
	});

	it("suppresses anything already marked automatic", () => {
		expect(suppress({ headers: { "Auto-Submitted": "auto-replied" } })).toBe("auto_submitted");
		expect(suppress({ headers: { "auto-submitted": "auto-generated" } })).toBe("auto_submitted");
		// Header names and values are both case-insensitive.
		expect(suppress({ headers: { "AUTO-SUBMITTED": "Auto-Replied" } })).toBe("auto_submitted");
	});

	it("does not suppress when Auto-Submitted explicitly says no", () => {
		// RFC 3834: "no" means the message is NOT automatic.
		expect(suppress({ headers: { "Auto-Submitted": "no" } })).toBeNull();
	});

	it("suppresses bulk, list, and junk precedence", () => {
		for (const value of ["bulk", "list", "junk", "BULK"]) {
			expect(suppress({ headers: { Precedence: value } })).toBe("bulk_precedence");
		}
		expect(suppress({ headers: { Precedence: "normal" } })).toBeNull();
	});

	it("suppresses mailing list traffic on any List- header", () => {
		expect(suppress({ headers: { "List-Id": "<dev.example.net>" } })).toBe("mailing_list");
		expect(suppress({ headers: { "List-Unsubscribe": "<https://x/y>" } })).toBe("mailing_list");
		expect(suppress({ headers: { "list-help": "<mailto:h@x>" } })).toBe("mailing_list");
	});

	it("honors an explicit auto-response suppression request", () => {
		expect(suppress({ headers: { "X-Auto-Response-Suppress": "OOF" } })).toBe("suppress_requested");
		expect(suppress({ headers: { "x-auto-response-suppress": "All" } })).toBe("suppress_requested");
	});

	it("suppresses automated sender addresses", () => {
		for (const from of [
			"noreply@example.net",
			"no-reply@example.net",
			"MAILER-DAEMON@example.net",
			"postmaster@example.net",
			"bounces+abc@example.net",
		]) {
			expect(suppress({ from })).toBe("automated_sender");
		}
	});

	it("never replies to itself", () => {
		expect(suppress({ from: "owner@example.com", to: "Owner@example.com" })).toBe("self");
	});
});

describe("withinVacationReplyWindow", () => {
	const now = new Date("2026-07-25T12:00:00Z");

	it("allows the first reply to a correspondent", async () => {
		mock.queueSelect([]);

		await expect(
			withinVacationReplyWindow(mock.db, "mb_1", "correspondent@example.net", now),
		).resolves.toBe(false);
	});

	it("suppresses a second reply inside the window", async () => {
		mock.queueSelect([{ lastRepliedAt: new Date("2026-07-24T12:00:00Z") }]);

		await expect(
			withinVacationReplyWindow(mock.db, "mb_1", "correspondent@example.net", now),
		).resolves.toBe(true);
	});

	it("allows another reply once the window has passed", async () => {
		const past = new Date(now.getTime() - (VACATION_REPLY_WINDOW_DAYS + 1) * 86400000);
		mock.queueSelect([{ lastRepliedAt: past }]);

		await expect(
			withinVacationReplyWindow(mock.db, "mb_1", "correspondent@example.net", now),
		).resolves.toBe(false);
	});

	it("normalizes the correspondent address before matching", async () => {
		mock.queueSelect([{ lastRepliedAt: new Date("2026-07-24T12:00:00Z") }]);

		await expect(
			withinVacationReplyWindow(mock.db, "mb_1", "  Correspondent@Example.NET ", now),
		).resolves.toBe(true);
	});
});

describe("isVacationAudienceAllowed", () => {
	function allowed(
		responder: { replyToContacts: boolean; replyToOrganization: boolean },
		fromAddr = "correspondent@example.net",
		organizationId: string | null = "org_1",
	) {
		return isVacationAudienceAllowed(mock.db, {
			userId: "u1",
			organizationId,
			fromAddr,
			responder,
		});
	}

	it("replies to everyone when neither restriction is set", async () => {
		await expect(
			allowed({ replyToContacts: false, replyToOrganization: false }),
		).resolves.toBe(true);
		// No lookup is needed to answer everyone.
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("allows a known contact when restricted to contacts", async () => {
		mock.queueSelect([{ id: "c1" }]);

		await expect(
			allowed({ replyToContacts: true, replyToOrganization: false }),
		).resolves.toBe(true);
	});

	it("refuses a stranger when restricted to contacts", async () => {
		mock.queueSelect([]);

		await expect(
			allowed({ replyToContacts: true, replyToOrganization: false }),
		).resolves.toBe(false);
	});

	it("allows any sender on an organization domain", async () => {
		mock.queueSelect([{ id: "dom_1" }]);

		await expect(
			allowed({ replyToContacts: false, replyToOrganization: true }, "colleague@henriksen.dev"),
		).resolves.toBe(true);
	});

	it("refuses an outside domain when restricted to the organization", async () => {
		mock.queueSelect([]);

		await expect(
			allowed({ replyToContacts: false, replyToOrganization: true }, "outsider@example.net"),
		).resolves.toBe(false);
	});

	it("combines both restrictions as OR", async () => {
		// Not a contact, but on an organization domain.
		mock.queueSelect([]);
		mock.queueSelect([{ id: "dom_1" }]);

		await expect(
			allowed({ replyToContacts: true, replyToOrganization: true }, "colleague@henriksen.dev"),
		).resolves.toBe(true);
	});

	it("refuses a sender in neither audience when both are set", async () => {
		mock.queueSelect([]);
		mock.queueSelect([]);

		await expect(
			allowed({ replyToContacts: true, replyToOrganization: true }, "stranger@example.net"),
		).resolves.toBe(false);
	});

	it("refuses the organization audience for a personal account with no organization", async () => {
		// Nothing can be "internal" without an organization to be internal to.
		await expect(
			allowed({ replyToContacts: false, replyToOrganization: true }, "anyone@example.net", null),
		).resolves.toBe(false);
	});

	it("refuses an unparseable sender under the organization restriction", async () => {
		await expect(
			allowed({ replyToContacts: false, replyToOrganization: true }, "not-an-address"),
		).resolves.toBe(false);
	});
});

describe("AUTO_REPLY_HEADERS", () => {
	it("marks our replies automatic so other responders stand down", () => {
		// RFC 3834. Without this, two enabled responders reply to each other forever.
		expect(AUTO_REPLY_HEADERS["Auto-Submitted"]).toBe("auto-replied");
	});

	it("asks conforming systems not to auto-respond in turn", () => {
		expect(AUTO_REPLY_HEADERS["X-Auto-Response-Suppress"]).toBe("All");
	});

	it("would be suppressed by our own rules, which is what ends a loop", () => {
		expect(shouldSuppressVacationReply({
			fromAddr: "owner@example.com",
			toAddr: "correspondent@example.net",
			headers: AUTO_REPLY_HEADERS,
		})).toBe("auto_submitted");
	});
});
