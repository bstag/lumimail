import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	hashPassword: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/password", () => ({
	hashPassword: m.hashPassword,
	verifyPassword: vi.fn(),
}));
vi.mock("@/lib/ids", () => ({ newId: (p?: string) => (p ? `${p}_1` : "id_1") }));

import { POST } from "@/app/api/auth/forgot-password/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.hashPassword.mockReset().mockReturnValue("token-hash");
	vi.unstubAllEnvs();
});

function req(body?: unknown, headers?: Record<string, string>) {
	return new Request("https://x.test/api/auth/forgot-password", {
		method: "POST",
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("POST /api/auth/forgot-password", () => {
	it("returns 400 when email is missing", async () => {
		const res = await POST(req({}));
		expect(res.status).toBe(400);
		expect((await res.json()) as any).toMatchObject({ success: false });
	});

	it("returns 400 when email is not a string", async () => {
		const res = await POST(req({ email: 123 }));
		expect(res.status).toBe(400);
	});

	it("returns a generic success when the user does not exist", async () => {
		mock.queueSelect([]);
		const res = await POST(req({ email: "nobody@x.test" }));
		expect(res.status).toBe(200);
		expect((await res.json()) as any).toMatchObject({
			success: true,
			data: { message: "If the account exists, a reset link has been sent." },
		});
		expect(mock.inserts.length).toBe(0);
	});

	it("returns a generic success when the user has no resetEmail", async () => {
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: null }]);
		const res = await POST(req({ email: "a@x.test" }));
		expect(res.status).toBe(200);
		expect(mock.inserts.length).toBe(0);
	});

	it("creates a reset token and includes the dev link outside production", async () => {
		vi.stubEnv("NODE_ENV", "development");
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: "r@x.test" }]);
		const res = await POST(req({ email: "  A@x.test " }, { origin: "https://app.test" }));
		expect(res.status).toBe(200);
		const json = (await res.json()) as any;
		expect(json.data.resetLink).toBe(
			"https://app.test/reset-password?token=pwr_1&email=a%40x.test",
		);
		expect(mock.inserts[0].values).toMatchObject({ userId: "u1", tokenHash: "token-hash", used: false });
	});

	it("omits the dev link in production and uses empty origin when absent", async () => {
		vi.stubEnv("NODE_ENV", "production");
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: "r@x.test" }]);
		const res = await POST(req({ email: "a@x.test" }));
		expect(res.status).toBe(200);
		const json = (await res.json()) as any;
		expect(json.data.resetLink).toBeUndefined();
	});
});
