import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, hashInvitationToken: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/invitation", () => ({ hashInvitationToken: m.hashInvitationToken }));

import { GET } from "@/app/api/org/invites/[token]/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.hashInvitationToken.mockReset().mockResolvedValue("hashed_tok");
});

const params = (token = "tok") => ({ params: Promise.resolve({ token }) });
const req = () => new Request("https://x.test/api/org/invites/tok");

describe("GET /api/org/invites/[token]", () => {
	it("returns 404 when the invite is not found", async () => {
		mock.queueSelect([]);
		const res = await GET(req(), params());
		expect(res.status).toBe(404);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Invite not found" } });
		expect(m.hashInvitationToken).toHaveBeenCalledWith("tok");
	});

	it("returns 410 when the invite has expired", async () => {
		mock.queueSelect([
			{
				email: "a@x.test",
				orgName: "Acme",
				role: "member",
				expiresAt: new Date(Date.now() - 1000).toISOString(),
			},
		]);
		const res = await GET(req(), params());
		expect(res.status).toBe(410);
		expect((await res.json()) as any).toMatchObject({ error: { message: "Invite has expired" } });
	});

	it("returns the invite details when valid", async () => {
		mock.queueSelect([
			{
				email: "a@x.test",
				orgName: "Acme",
				role: "admin",
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			},
		]);
		const res = await GET(req(), params());
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toEqual({
			success: true,
			data: { email: "a@x.test", orgName: "Acme", role: "admin" },
		});
	});
});
