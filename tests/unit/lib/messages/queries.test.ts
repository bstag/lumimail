import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/contacts/service", () => ({ getMessageContactNames: vi.fn() }));

import { getMessageWithBody } from "@/lib/messages/queries";
import { getMessageContactNames as contactNamesImport } from "@/lib/contacts/service";

const getMessageContactNames = vi.mocked(contactNamesImport);

let mock: DbMock;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
	h.db = mock.db;
});

describe("getMessageWithBody", () => {
	const env = {} as CloudflareEnv;

	it("returns null when the message is missing", async () => {
		mock.queueSelect([]);
		expect(await getMessageWithBody(env, "u1", null, "msg_1")).toBeNull();
	});

	it("returns null when the message belongs to another user", async () => {
		mock.queueSelect([]);
		expect(await getMessageWithBody(env, "u1", "org_1", "msg_1")).toBeNull();
	});

	it("returns the message merged with contact names plus the body", async () => {
		mock
			.queueSelect([{ id: "msg_1", userId: "u1", fromAddr: "f@x.com", toAddr: "t@y.com" }])
			.queueSelect([{ id: "body_1", messageId: "msg_1", textBody: "t" }]);
		getMessageContactNames.mockResolvedValue({ fromContactName: "F", toContactName: "T" });

		const result = await getMessageWithBody(env, "u1", "org_1", "msg_1");
		expect(getMessageContactNames).toHaveBeenCalledWith(env, "u1", "f@x.com", "t@y.com");
		expect(result).toEqual({
			message: { id: "msg_1", userId: "u1", fromAddr: "f@x.com", toAddr: "t@y.com", fromContactName: "F", toContactName: "T" },
			body: { id: "body_1", messageId: "msg_1", textBody: "t" },
		});
	});

	it("supports an explicit mailbox constraint for bridge reads", async () => {
		mock
			.queueSelect([{ id: "msg_1", mailboxId: "mb1", fromAddr: "f@x.com", toAddr: "t@y.com" }])
			.queueSelect([]);
		getMessageContactNames.mockResolvedValue({ fromContactName: null, toContactName: null });

		const result = await getMessageWithBody(env, "u1", "org_1", "msg_1", "mb1");

		expect(result?.message).toMatchObject({ id: "msg_1", mailboxId: "mb1" });
	});
});
