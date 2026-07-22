import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../helpers/db";

const m = vi.hoisted(() => ({
	db: null as unknown,
	env: {
		PUBLIC_APP_URL: "https://mail.example.com",
		PASSWORD_RESET_FROM: "noreply@example.com",
	} as CloudflareEnv,
	hashToken: vi.fn(),
	sendResetEmail: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => m.env }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/password-reset", () => ({
	hashPasswordResetToken: m.hashToken,
	buildPasswordResetLink: (base: string, token: string, email: string) => {
		if (!base) throw new Error("PUBLIC_APP_URL is required");
		return `${base}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
	},
	sendPasswordResetEmail: m.sendResetEmail,
}));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => (prefix ? `${prefix}_secret` : "id_1") }));

import { POST } from "@/app/api/auth/forgot-password/route";

let mock: DbMock;

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.env.PUBLIC_APP_URL = "https://mail.example.com";
	m.env.PASSWORD_RESET_FROM = "noreply@example.com";
	m.hashToken.mockReset().mockResolvedValue("token-hash");
	m.sendResetEmail.mockReset().mockResolvedValue(undefined);
	vi.restoreAllMocks();
});

function req(body?: unknown) {
	return new Request("https://attacker.example/api/auth/forgot-password", {
		method: "POST",
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

const genericBody = {
	success: true,
	data: { message: "If the account exists, a reset link has been sent." },
};

describe("POST /api/auth/forgot-password", () => {
	it.each([{}, { email: 123 }, { email: "not-an-email" }])(
		"returns 400 for invalid input %#",
		async (body) => {
			const res = await POST(req(body));
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ success: false });
		},
	);

	it("returns 400 for malformed JSON", async () => {
		const res = await POST(
			new Request("https://x.test/api/auth/forgot-password", { method: "POST", body: "{" }),
		);
		expect(res.status).toBe(400);
	});

	it("returns the same generic success when the user does not exist", async () => {
		mock.queueSelect([]);
		const res = await POST(req({ email: "nobody@x.test" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(genericBody);
		expect(mock.inserts).toHaveLength(0);
		expect(m.sendResetEmail).not.toHaveBeenCalled();
	});

	it("returns the same generic success when the user has no recovery address", async () => {
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: null }]);
		const res = await POST(req({ email: "a@x.test" }));
		expect(await res.json()).toEqual(genericBody);
		expect(mock.inserts).toHaveLength(0);
		expect(m.sendResetEmail).not.toHaveBeenCalled();
	});

	it("stores a token digest and sends the reset link only to the recovery address", async () => {
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: "recovery@x.test" }]);
		const res = await POST(req({ email: "  A@x.test " }));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(genericBody);
		expect(m.hashToken).toHaveBeenCalledWith("pwr_secret");
		expect(mock.inserts[0].values).toMatchObject({
			id: "id_1",
			userId: "u1",
			tokenHash: "token-hash",
			used: false,
		});
		expect(m.sendResetEmail).toHaveBeenCalledWith(
			m.env,
			"recovery@x.test",
			"https://mail.example.com/reset-password?token=pwr_secret&email=a%40x.test",
		);
	});

	it("does not expose a reset token or link in any environment", async () => {
		vi.stubEnv("NODE_ENV", "development");
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: "recovery@x.test" }]);
		const body = JSON.stringify(await (await POST(req({ email: "a@x.test" }))).json());
		expect(body).not.toContain("pwr_secret");
		expect(body).not.toContain("reset-password");
	});

	it("removes the token and preserves the generic response when delivery fails", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: "recovery@x.test" }]);
		m.sendResetEmail.mockRejectedValue(new Error("provider included sensitive detail"));

		const res = await POST(req({ email: "a@x.test" }));

		expect(await res.json()).toEqual(genericBody);
		expect(mock.deletes).toHaveLength(1);
		expect(errorSpy).toHaveBeenCalledWith("Password reset email delivery failed");
		expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sensitive detail");
	});

	it("preserves the generic response when failure occurs before token storage", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: "recovery@x.test" }]);
		m.hashToken.mockRejectedValue(new Error("hash unavailable"));

		const res = await POST(req({ email: "a@x.test" }));

		expect(await res.json()).toEqual(genericBody);
		expect(mock.deletes).toHaveLength(0);
		expect(errorSpy).toHaveBeenCalledWith("Password reset email delivery failed");
	});

	it("cleans up safely when the canonical application URL is not configured", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		m.env.PUBLIC_APP_URL = undefined;
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: "recovery@x.test" }]);

		const res = await POST(req({ email: "a@x.test" }));

		expect(await res.json()).toEqual(genericBody);
		expect(mock.deletes).toHaveLength(1);
		expect(m.sendResetEmail).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledWith("Password reset email delivery failed");
	});

	it("does not expose cleanup failure after a delivery error", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		mock.queueSelect([{ id: "u1", email: "a@x.test", resetEmail: "recovery@x.test" }]);
		m.sendResetEmail.mockRejectedValue(new Error("delivery failed"));
		(m.db as DbMock["db"]).delete.mockImplementationOnce(() => ({
			where: vi.fn().mockRejectedValue(new Error("cleanup sensitive detail")),
		}));

		const res = await POST(req({ email: "a@x.test" }));

		expect(await res.json()).toEqual(genericBody);
		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("cleanup sensitive detail");
	});
});
