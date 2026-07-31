import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const m = vi.hoisted(() => ({
	getMailboxAccess: vi.fn(),
	selectAccessibleReplySource: vi.fn(),
}));
vi.mock("@/lib/auth/mailbox-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth/mailbox-access")>()),
	getMailboxAccess: m.getMailboxAccess,
}));
vi.mock("@/lib/email/reply-source", () => ({
	selectAccessibleReplySource: m.selectAccessibleReplySource,
}));

import {
	normalizedReplySourceId,
	validateDraftAccess,
	validateDraftInput,
	validateReplySourceShape,
} from "@/lib/drafts/validate";

let mock: DbMock;
const orgUser = { id: "u1", organizationId: "o1" };
const soloUser = { id: "u1", organizationId: null };

function db() {
	return mock.db as unknown as Parameters<typeof validateDraftAccess>[0];
}

beforeEach(() => {
	mock = createDbMock();
	m.getMailboxAccess.mockReset();
	m.selectAccessibleReplySource.mockReset();
});

describe("validateReplySourceShape", () => {
	it("accepts an absent replyToMessageId", () => {
		expect(validateReplySourceShape({})).toBeNull();
	});

	it("accepts a plausible reply source id", () => {
		expect(validateReplySourceShape({ replyToMessageId: "msg_parent" })).toBeNull();
	});

	it.each([
		["a non-string value", 42],
		["an empty string", ""],
		["a whitespace-only string", "   "],
		["an overlong id", "x".repeat(101)],
	])("rejects %s with the historical bare 400", async (_label, replyToMessageId) => {
		const res = validateReplySourceShape({ replyToMessageId });
		expect(res?.status).toBe(400);
		expect((await res!.json()) as unknown).toEqual({ error: "Invalid reply source" });
	});
});

describe("validateDraftAccess", () => {
	it("passes when neither a mailbox nor a reply source is requested", async () => {
		expect(await validateDraftAccess(db(), orgUser, {})).toBeNull();
		expect(m.getMailboxAccess).not.toHaveBeenCalled();
	});

	it("hides the mailbox from a user without an organization", async () => {
		const res = await validateDraftAccess(db(), soloUser, { mailboxId: "mb_1" });
		expect(res?.status).toBe(404);
		expect((await res!.json()) as unknown).toEqual({ error: "Mailbox not found" });
		expect(m.getMailboxAccess).not.toHaveBeenCalled();
	});

	it("hides a mailbox the user cannot access", async () => {
		m.getMailboxAccess.mockResolvedValue(null);
		const res = await validateDraftAccess(db(), orgUser, { mailboxId: "mb_1" });
		expect(res?.status).toBe(404);
	});

	it("hides a mailbox without the send capability", async () => {
		m.getMailboxAccess.mockResolvedValue({ role: "viewer" });
		const res = await validateDraftAccess(db(), orgUser, { mailboxId: "mb_1" });
		expect(res?.status).toBe(404);
	});

	it("accepts a sendable mailbox", async () => {
		m.getMailboxAccess.mockResolvedValue({ role: "responder" });
		expect(await validateDraftAccess(db(), orgUser, { mailboxId: "mb_1" })).toBeNull();
	});

	it("rejects a reply source without a mailbox", async () => {
		const res = await validateDraftAccess(db(), orgUser, { replyToMessageId: "msg_parent" });
		expect(res?.status).toBe(404);
		expect((await res!.json()) as unknown).toEqual({ error: "Reply source not found" });
		expect(m.selectAccessibleReplySource).not.toHaveBeenCalled();
	});

	it("rejects an inaccessible reply source", async () => {
		m.getMailboxAccess.mockResolvedValue({ role: "responder" });
		m.selectAccessibleReplySource.mockResolvedValue(null);
		const res = await validateDraftAccess(db(), orgUser, {
			mailboxId: "mb_1",
			replyToMessageId: "msg_parent",
		});
		expect(res?.status).toBe(404);
	});

	it("accepts an accessible reply source, trimming the id for the lookup", async () => {
		m.getMailboxAccess.mockResolvedValue({ role: "responder" });
		m.selectAccessibleReplySource.mockResolvedValue({ id: "msg_parent" });
		const res = await validateDraftAccess(db(), orgUser, {
			mailboxId: "mb_1",
			replyToMessageId: " msg_parent ",
		});
		expect(res).toBeNull();
		expect(m.selectAccessibleReplySource).toHaveBeenCalledWith(
			db(),
			"u1",
			"o1",
			"mb_1",
			"msg_parent",
		);
	});
});

describe("validateDraftInput", () => {
	it("returns the shape failure before any access lookup", async () => {
		const res = await validateDraftInput(db(), orgUser, {
			mailboxId: "mb_1",
			replyToMessageId: "",
		});
		expect(res?.status).toBe(400);
		expect(m.getMailboxAccess).not.toHaveBeenCalled();
	});

	it("runs the access checks when the shape is acceptable", async () => {
		m.getMailboxAccess.mockResolvedValue({ role: "responder" });
		m.selectAccessibleReplySource.mockResolvedValue({ id: "msg_parent" });
		const res = await validateDraftInput(db(), orgUser, {
			mailboxId: "mb_1",
			replyToMessageId: "msg_parent",
		});
		expect(res).toBeNull();
	});
});

describe("normalizedReplySourceId", () => {
	it("returns the trimmed id for a reply draft", () => {
		expect(normalizedReplySourceId({ replyToMessageId: " msg_parent " })).toBe("msg_parent");
	});

	it("returns null when the draft is not a reply", () => {
		expect(normalizedReplySourceId({})).toBeNull();
	});
});
