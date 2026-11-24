import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMigratedDb } from "../../helpers/sqlite";
import type { ResolvedMailbox } from "@/lib/email/routing";
import type { ParsedEmail } from "@/lib/email/parse";

const h = vi.hoisted(() => ({ db: null as unknown, routes: vi.fn(), parse: vi.fn(), filters: vi.fn(), vacation: vi.fn() }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/email/routing", () => ({ resolveInboundTargets: h.routes }));
vi.mock("@/lib/email/parse", async (original) => ({ ...await original<object>(), parseRawMime: h.parse }));
vi.mock("@/lib/email/message-filters", () => ({ applyMessageFilters: h.filters }));
vi.mock("@/lib/contacts/service", () => ({ upsertContactFromAddress: vi.fn() }));
vi.mock("@/lib/email/vacation-responder", () => ({ maybeVacationRespond: h.vacation }));

import { processInboundMessage } from "@/lib/email/inbound";
import { purgeInboundDeliveries } from "@/lib/email/inbound-delivery";

const mailbox: ResolvedMailbox = {
	mailboxId: "mbx_1", userId: "u1", organizationId: null, domainId: "dom",
	localPart: "team", hostname: "example.com", displayName: null,
};
const payload = { from: "sender@other.test", to: "team@example.com", rawR2Key: "inbound/1.eml" };
const parsed: ParsedEmail = {
	subject: "Hello", text: "hello", html: null, messageId: "<one@other.test>", inReplyTo: null, references: null,
	fromAddr: payload.from, toAddr: payload.to, attachments: [],
};
let sqlite: ReturnType<typeof createMigratedDb>["sqlite"];
let bucket: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

beforeEach(() => {
	vi.resetAllMocks();
	const db = createMigratedDb(100);
	sqlite = db.sqlite;
	h.db = db.db;
	h.parse.mockResolvedValue(parsed);
	h.vacation.mockResolvedValue(undefined);
	h.routes.mockResolvedValue([{ action: "store", mailbox }]);
	bucket = {
		get: vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) }),
		put: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	};
});

afterEach(() => sqlite.close());

function deliver(input = payload) {
	return processInboundMessage({ BUCKET: bucket } as unknown as CloudflareEnv, input);
}

it("commits the full attachment limit with a 100-bind D1 budget", async () => {
	h.parse.mockResolvedValue({
		...parsed,
		attachments: Array.from({ length: 50 }, (_, index) => ({
			filename: `file-${index}`, contentType: "text/plain", content: new ArrayBuffer(1),
			disposition: "attachment", contentId: null,
		})),
	});
	await deliver();
	expect(sqlite.prepare("SELECT count(*) AS n FROM attachments").get()).toEqual({ n: 50 });
	expect(bucket.put).toHaveBeenCalledTimes(50);
});

it("resumes a failed mailbox and its filters without duplicating committed deliveries", async () => {
	h.routes.mockResolvedValue([{ action: "store", mailbox }, { action: "store", mailbox: { ...mailbox, mailboxId: "mbx_2" } }]);
	h.filters.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("filter write failed"));
	await expect(deliver()).rejects.toThrow("filter write failed");
	const ids = () => sqlite.prepare("SELECT id, mailbox_id FROM messages ORDER BY mailbox_id").all();
	const firstDelivery = ids();
	expect(firstDelivery).toHaveLength(2);
	expect(bucket.delete).not.toHaveBeenCalled();

	await deliver();
	expect(ids()).toEqual(firstDelivery);
	expect(h.filters).toHaveBeenCalledTimes(3);
	expect(h.filters.mock.calls[2][2]).toBe(firstDelivery[1].id);
	expect(bucket.delete).toHaveBeenCalledWith(payload.rawR2Key);

	await deliver({ ...payload, rawR2Key: "inbound/2.eml" });
	expect(ids()).toHaveLength(4);
});

it("resumes webhook scheduling without repeating filters or the webhook already recorded", async () => {
	const createHook = sqlite.prepare("INSERT INTO webhooks (id, user_id, url, secret, events, enabled, created_at) VALUES (?, 'u1', 'https://hook.example', 'test', ?, 1, 1)");
	createHook.run("first", '["message.inbound"]');
	createHook.run("second", '["message.inbound"]');
	sqlite.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON webhook_deliveries
		WHEN NEW.webhook_id = 'second' BEGIN SELECT RAISE(ABORT, 'webhook write failed'); END;`);
	await expect(deliver()).rejects.toMatchObject({ cause: { message: "webhook write failed" } });
	expect(sqlite.prepare("SELECT webhook_id FROM webhook_deliveries").all()).toEqual([{ webhook_id: "first" }]);

	sqlite.exec("DROP TRIGGER fail_second");
	const warning = vi.spyOn(console, "warn").mockImplementationOnce(() => {});
	h.vacation.mockRejectedValueOnce(new Error("vacation unavailable"));
	try {
		await deliver();
		expect(warning).toHaveBeenCalledWith("Inbound vacation reply failed");
	} finally {
		warning.mockRestore();
	}
	expect(h.filters).toHaveBeenCalledOnce();
	expect(h.vacation).toHaveBeenCalledOnce();
	expect(sqlite.prepare("SELECT webhook_id FROM webhook_deliveries ORDER BY webhook_id").all())
		.toEqual([{ webhook_id: "first" }, { webhook_id: "second" }]);
});

it("does not recreate a deleted delivery and only purges old completed checkpoints", async () => {
	h.filters.mockRejectedValueOnce(new Error("retry filters"));
	await expect(deliver()).rejects.toThrow("retry filters");
	sqlite.exec("UPDATE inbound_deliveries SET message_id = NULL, created_at = 1");
	sqlite.exec("DELETE FROM messages");
	await deliver();
	expect(sqlite.prepare("SELECT id FROM messages").all()).toEqual([]);
	expect(sqlite.prepare("SELECT stage FROM inbound_deliveries").all()).toEqual([{ stage: "complete" }]);
	sqlite.exec(`INSERT INTO inbound_deliveries (raw_r2_key, mailbox_id, stage, created_at)
		VALUES ('inbound/pending.eml', 'mbx_1', 'filters', 1)`);
	await purgeInboundDeliveries({} as CloudflareEnv);
	expect(sqlite.prepare("SELECT stage FROM inbound_deliveries").all()).toEqual([{ stage: "filters" }]);
});

it("does not send a second vacation response when another consumer finalizes the delivery", async () => {
	h.filters.mockImplementationOnce(async () => sqlite.exec("UPDATE inbound_deliveries SET stage = 'complete'"));
	await deliver();
	expect(h.vacation).not.toHaveBeenCalled();
});
