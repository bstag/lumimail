import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claimFirstRunUser } from "@/lib/auth/bootstrap";

let db: DatabaseSync;
let env: Pick<CloudflareEnv, "DB">;
const user = { id: "u1", email: "owner@example.com", resetEmail: "reset@example.net", passwordHash: "hash", name: "owner" };

beforeEach(() => {
	db = new DatabaseSync(":memory:");
	db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, reset_email TEXT, password_hash TEXT, name TEXT, organization_id TEXT, created_at INTEGER); CREATE TABLE domains (id TEXT);");
	env = { DB: { prepare: (query: string) => ({ bind: (...values: string[]) => ({ first: async () => db.prepare(query).get(...values) ?? null }) }) } } as unknown as Pick<CloudflareEnv, "DB">;
});
afterEach(() => db.close());

describe("first-owner claim", () => {
	it("persists only one of simultaneous first-run claims", async () => {
		const results = await Promise.all([claimFirstRunUser(env, user), claimFirstRunUser(env, { ...user, id: "u2", email: "other@example.com" })]);
		expect(results).toEqual([true, false]);
		expect(db.prepare("SELECT id, email, password_hash, organization_id FROM users").all()).toEqual([{ id: "u1", email: user.email, password_hash: "hash", organization_id: null }]);
	});
	it("denies registration when users remain after the last domain was deleted", async () => {
		db.exec("INSERT INTO users (id, email) VALUES ('existing', 'existing@example.org')");
		expect(await claimFirstRunUser(env, user)).toBe(false);
	});
	it("denies a remaining domain even with no users", async () => {
		db.exec("INSERT INTO domains VALUES ('domain')");
		expect(await claimFirstRunUser(env, user)).toBe(false);
	});
	it("allows retry after compensation removes the first failed account", async () => {
		expect(await claimFirstRunUser(env, user)).toBe(true);
		db.exec("DELETE FROM users");
		expect(await claimFirstRunUser(env, user)).toBe(true);
	});
	it("persists an omitted reset address as null", async () => {
		expect(await claimFirstRunUser(env, { ...user, resetEmail: undefined })).toBe(true);
		expect(db.prepare("SELECT reset_email FROM users").get()).toEqual({ reset_email: null });
	});
	it("fails closed on database errors", async () => {
		db.exec("DROP TABLE users");
		await expect(claimFirstRunUser(env, user)).rejects.toThrow();
	});
});
