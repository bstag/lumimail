import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	hashPassword: vi.fn(),
	createSession: vi.fn(),
	addDomainForUser: vi.fn(),
	ensureEmailRoutingRuleToWorker: vi.fn(),
	getPrimaryDomain: vi.fn(),
	getPrimaryDomainForOrg: vi.fn(),
	ensureUserOrg: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: m.hashPassword }));
vi.mock("@/lib/auth/session", () => ({
	createSession: m.createSession,
	SESSION_COOKIE: "ep_session",
}));
vi.mock("@/lib/ids", () => ({ newId: (p?: string) => (p ? `${p}_1` : "id_1") }));
vi.mock("@/lib/domains/service", () => ({ addDomainForUser: m.addDomainForUser }));
vi.mock("@/lib/cloudflare-api", () => ({
	ensureEmailRoutingRuleToWorker: m.ensureEmailRoutingRuleToWorker,
}));
vi.mock("@/lib/user", () => ({
	getPrimaryDomain: m.getPrimaryDomain,
	getPrimaryDomainForOrg: m.getPrimaryDomainForOrg,
}));
vi.mock("@/lib/migration/backfill-orgs", () => ({ ensureUserOrg: m.ensureUserOrg }));

import { POST } from "@/app/api/auth/register/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.hashPassword.mockReset().mockReturnValue("pw-hash");
	m.createSession.mockReset().mockResolvedValue("sess-token");
	m.addDomainForUser.mockReset();
	m.ensureEmailRoutingRuleToWorker.mockReset().mockResolvedValue(undefined);
	m.getPrimaryDomain.mockReset();
	m.getPrimaryDomainForOrg.mockReset();
	m.ensureUserOrg.mockReset().mockResolvedValue("org_1");
});

function req(body?: unknown) {
	return new Request("https://x.test/api/auth/register", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

const firstRunBody = {
	domain: "example.com",
	username: "ada",
	password: "longenough",
	resetEmail: "ada@reset.test",
};

const primaryBody = {
	username: "ada",
	password: "longenough",
	resetEmail: "ada@reset.test",
};

describe("POST /api/auth/register — invite handling", () => {
	it("returns 404 when the invite token is invalid/expired", async () => {
		mock.queueSelect([]); // invite lookup -> none
		const res = await POST(req({ inviteToken: "bad", ...primaryBody }));
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Invite not found or expired" } });
	});
});

describe("POST /api/auth/register — first run", () => {
	it("returns 400 for an invalid first-run body", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		const res = await POST(req({ username: "ada" })); // missing domain/password/resetEmail
		expect(res.status).toBe(400);
	});

	it("returns 409 when the email is already registered", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		mock.queueSelect([{ id: "u-old", email: "ada@example.com" }]); // existing user
		const res = await POST(req(firstRunBody));
		expect(res.status).toBe(409);
		expect((await res.json()) as any).toEqual({ error: "Email already registered" });
	});

	it("creates the first user, domain, and mailbox", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		mock.queueSelect([]); // no existing user
		m.addDomainForUser.mockResolvedValue({
			domain: { id: "dom_1", zoneId: "zone_1" },
		});
		const res = await POST(req(firstRunBody));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ token: "sess-token", redirect: "/inbox" });
		expect(res.cookies.get("ep_session")?.value).toBe("sess-token");
		expect(mock.inserts[0].values).toMatchObject({
			id: "usr_1",
			email: "ada@example.com",
			passwordHash: "pw-hash",
		});
		expect(m.addDomainForUser).toHaveBeenCalled();
		expect(m.ensureUserOrg).toHaveBeenCalled();
	});

	it("rolls back the user and returns 502 when domain setup fails", async () => {
		m.getPrimaryDomain.mockResolvedValue(null);
		mock.queueSelect([]); // no existing user
		m.addDomainForUser.mockRejectedValue(new Error("boom"));
		const res = await POST(req(firstRunBody));
		expect(res.status).toBe(502);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Domain setup failed" } });
		expect(mock.deletes.length).toBeGreaterThan(0); // user deleted
	});
});

describe("POST /api/auth/register — primary domain (non-first-run)", () => {
	const primaryDomain = { id: "dom_p", hostname: "team.test", zoneId: "zone_p" };

	it("returns 400 for an invalid primary-domain body", async () => {
		m.getPrimaryDomain.mockResolvedValue(primaryDomain);
		const res = await POST(req({ password: "x" })); // missing username/resetEmail, weak password
		expect(res.status).toBe(400);
	});

	it("returns 409 when the mailbox already exists", async () => {
		m.getPrimaryDomain.mockResolvedValue(primaryDomain);
		mock.queueSelect([]); // no existing user
		mock.queueSelect([{ id: "mbx-old" }]); // existing mailbox
		const res = await POST(req(primaryBody));
		expect(res.status).toBe(409);
		expect((await res.json()) as any).toEqual({ error: "Mailbox already exists" });
		expect(mock.deletes.length).toBeGreaterThan(0);
	});

	it("returns 502 with the error message when routing fails", async () => {
		m.getPrimaryDomain.mockResolvedValue(primaryDomain);
		mock.queueSelect([]); // no existing user
		mock.queueSelect([]); // no existing mailbox
		m.ensureEmailRoutingRuleToWorker.mockRejectedValue(new Error("routing down"));
		const res = await POST(req(primaryBody));
		expect(res.status).toBe(502);
		expect((await res.json()) as any).toEqual({ error: "routing down" });
	});

	it("returns 502 with a default message for a non-Error rejection", async () => {
		m.getPrimaryDomain.mockResolvedValue(primaryDomain);
		mock.queueSelect([]); // no existing user
		mock.queueSelect([]); // no existing mailbox
		m.ensureEmailRoutingRuleToWorker.mockRejectedValue("nope");
		const res = await POST(req(primaryBody));
		expect(res.status).toBe(502);
		expect((await res.json()) as any).toEqual({ error: "Mailbox setup failed" });
	});

	it("registers against the primary domain on success", async () => {
		m.getPrimaryDomain.mockResolvedValue(primaryDomain);
		mock.queueSelect([]); // no existing user
		mock.queueSelect([]); // no existing mailbox
		const res = await POST(req(primaryBody));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({ token: "sess-token", redirect: "/inbox" });
		expect(mock.inserts.find((i) => (i.values as { email?: string }).email === "ada@team.test")).toBeTruthy();
		expect(m.ensureEmailRoutingRuleToWorker).toHaveBeenCalledWith({}, "zone_p", "ada@team.test");
	});
});

describe("POST /api/auth/register — invite-driven (non-first-run)", () => {
	it("uses the invite org, adds membership, and consumes the invite", async () => {
		const invite = {
			id: "inv_1",
			organizationId: "org_inv",
			role: "member",
			token: "good",
			expiresAt: new Date(Date.now() + 60_000),
		};
		mock.queueSelect([invite]); // invite lookup
		m.getPrimaryDomainForOrg.mockResolvedValue({ id: "dom_o", hostname: "org.test", zoneId: "zone_o" });
		mock.queueSelect([]); // no existing user
		mock.queueSelect([]); // no existing mailbox
		const res = await POST(req({ inviteToken: "good", ...primaryBody }));
		expect(res.status).toBe(200);
		// membership insert + invite delete happened
		expect(mock.inserts.some((i) => (i.values as { role?: string }).role === "member")).toBe(true);
		expect(mock.deletes.length).toBeGreaterThan(0);
		// invite path does not call ensureUserOrg
		expect(m.ensureUserOrg).not.toHaveBeenCalled();
	});

	it("restores the invite when an invited primary-domain mailbox already exists", async () => {
		const invite = {
			id: "inv_1",
			organizationId: "org_inv",
			role: "admin",
			token: "good",
			expiresAt: new Date(Date.now() + 60_000),
		};
		mock.queueSelect([invite]); // invite lookup
		m.getPrimaryDomainForOrg.mockResolvedValue({ id: "dom_o", hostname: "org.test", zoneId: "zone_o" });
		mock.queueSelect([]); // no existing user
		mock.queueSelect([{ id: "mbx-old" }]); // existing mailbox
		const res = await POST(req({ inviteToken: "good", ...primaryBody }));
		expect(res.status).toBe(409);
		// invite re-inserted after rollback
		expect(mock.inserts.some((i) => (i.values as { token?: string }).token === "good")).toBe(true);
	});
});
