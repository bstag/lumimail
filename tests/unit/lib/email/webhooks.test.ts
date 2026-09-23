import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
import { dispatchWebhooks, processDueWebhooks } from "@/lib/email/webhooks";

const env = {} as CloudflareEnv;
let sqlite: DatabaseSync;
let fetchMock: ReturnType<typeof vi.fn>;
const now = new Date("2026-09-05T12:00:00Z");
const seconds = now.getTime() / 1000;

beforeEach(() => {
 sqlite = new DatabaseSync(":memory:");
 sqlite.exec("CREATE TABLE webhooks (id TEXT PRIMARY KEY, user_id TEXT, organization_id TEXT, url TEXT, secret TEXT, events TEXT, enabled INTEGER, created_at INTEGER); CREATE TABLE webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT, event_type TEXT, payload TEXT, status TEXT, attempts INTEGER, next_attempt_at INTEGER DEFAULT 0, created_at INTEGER);");
 h.db = drizzle(async (query, params, method) => {
  const statement = sqlite.prepare(query);
  if (method === "run") { statement.run(...params); return { rows: [] }; }
  statement.setReturnArrays(true);
  return { rows: statement.all(...params) as unknown as unknown[][] };
 });
 fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
 vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); sqlite.close(); });

function hook(id = "h1", enabled = 1, events = '["message.inbound"]', userId = "u1") {
 sqlite.prepare("INSERT INTO webhooks VALUES (?, ?, NULL, ?, 'secret', ?, ?, ?)").run(id, userId, "https://hooks.test/" + id, events, enabled, seconds);
}
function job(id = "j1", attempts = 0, due = seconds, hookId = "h1") {
 sqlite.prepare("INSERT INTO webhook_deliveries VALUES (?, ?, 'message.inbound', '{}', 'pending', ?, ?, ?)").run(id, hookId, attempts, due, seconds);
}
function state(id = "j1") { return sqlite.prepare("SELECT status, attempts FROM webhook_deliveries WHERE id = ?").get(id); }

describe("dispatchWebhooks", () => {
 it("only persists subscribed jobs for the given user without any external HTTP", async () => {
  hook(); hook("disabled", 0); hook("other", 1, '["message.inbound"]', "u2"); hook("wrong", 1, '["message.outbound"]'); hook("invalid", 1, "invalid"); hook("scalar", 1, 'null');
  await dispatchWebhooks(env, "u1", "message.inbound", { messageId: "m1" });
  const rows = sqlite.prepare("SELECT webhook_id, payload, status, attempts, next_attempt_at FROM webhook_deliveries").all();
  expect(rows).toEqual([{ webhook_id: "h1", payload: JSON.stringify({ type: "message.inbound", data: { messageId: "m1" } }), status: "pending", attempts: 0, next_attempt_at: expect.any(Number) }]);
  expect(fetchMock).not.toHaveBeenCalled();
 });
 it("does nothing for no hooks", async () => {
  await dispatchWebhooks(env, "u1", "message.inbound", {});
  expect(sqlite.prepare("SELECT * FROM webhook_deliveries").all()).toEqual([]);
 });
});

describe("scheduled webhook delivery", () => {
 it("signs the original payload, supplies a stable ID and cancels the response body", async () => {
  hook(); job(); const cancel = vi.fn();
  fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 200 }));
  await processDueWebhooks(env, now);
  expect(state()).toEqual({ status: "delivered", attempts: 1 });
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith("https://hooks.test/h1", expect.objectContaining({ method: "POST", body: "{}", redirect: "error", signal: expect.any(AbortSignal), headers: expect.objectContaining({ "X-Email-Platform-Event": "message.inbound", "X-Email-Platform-Delivery": "j1", "X-Email-Platform-Signature": expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
 });
 it.each([400, 429, 500])("classifies HTTP %i", async (status) => {
  hook(); job(); fetchMock.mockResolvedValue(new Response(null, { status }));
  await processDueWebhooks(env, now);
  expect(state()).toEqual({ status: status === 400 ? "failed" : "pending", attempts: 1 });
 });
 it("retries network failures with a one-minute backoff and stops after three attempts", async () => {
  hook(); job(); fetchMock.mockRejectedValue(new Error("network down"));
  await processDueWebhooks(env, now);
  await processDueWebhooks(env, now);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await processDueWebhooks(env, new Date(now.getTime() + 60_000));
  await processDueWebhooks(env, new Date(now.getTime() + 120_000));
  await processDueWebhooks(env, new Date(now.getTime() + 180_000));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(state()).toEqual({ status: "failed", attempts: 3 });
 });
 it("bounds a stalled endpoint to five seconds even when fetch ignores abort", async () => {
  hook(); job(); vi.useFakeTimers(); fetchMock.mockImplementation(() => new Promise(() => {}));
  const processing = processDueWebhooks(env, now);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await vi.advanceTimersByTimeAsync(5_001);
  await processing;
  expect(signal.aborted).toBe(true);
  expect(state()).toEqual({ status: "pending", attempts: 1 });
 });
 it("does not send disabled or deleted subscriptions or exhausted crash leases", async () => {
  hook("disabled", 0); hook(); job("j1", 0, seconds, "disabled"); job("j2", 0, seconds, "gone"); job("j3", 3);
  await processDueWebhooks(env, now);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(state("j1")?.status).toBe("failed"); expect(state("j2")?.status).toBe("failed"); expect(state("j3")?.status).toBe("failed");
 });
 it("claims a job only once across concurrent scheduler runs", async () => {
  hook(); job();
  await Promise.all([processDueWebhooks(env, now), processDueWebhooks(env, now)]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state()).toEqual({ status: "delivered", attempts: 1 });
 });
 it("processes ten due jobs at most per run and skips future work", async () => {
  hook(); for(let i = 0; i < 11; i++) job("j" + i); job("future", 0, seconds + 60);
  await processDueWebhooks(env, now);
  expect(fetchMock).toHaveBeenCalledTimes(10);
  expect(state("future")).toEqual({ status: "pending", attempts: 0 });
  await processDueWebhooks(env, now);
  expect(fetchMock).toHaveBeenCalledTimes(11);
 });
 it("isolates a job storage failure", async () => {
  const mock = createDbMock(); h.db = mock.db;
  mock.queueSelect([{ id: "j1", attempts: 0 }]);
  mock.db.update.mockImplementation(() => { throw new Error("storage down"); });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await processDueWebhooks(env);
  expect(warn).toHaveBeenCalledWith("Webhook delivery storage failed");
  warn.mockRestore();
 });
});
