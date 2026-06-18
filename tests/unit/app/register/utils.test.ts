import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/client", () => ({ persistAuthSession: vi.fn() }));

import { getInviteInfo, getSetupStatus, submitPrimaryDomain, submitRegistration } from "@/app/register/utils";

function jsonResponse(ok: boolean, body: unknown) {
	return { ok, json: async () => body } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let storage: { setItem: ReturnType<typeof vi.fn> };

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
	storage = { setItem: vi.fn() };
	vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("getSetupStatus", () => {
	it("fetches and returns the setup status", async () => {
		const status = { primaryDomainExists: true };
		fetchMock.mockResolvedValue(jsonResponse(true, status));
		expect(await getSetupStatus()).toEqual(status);
		expect(fetchMock).toHaveBeenCalledWith("/api/setup/status");
	});
});

describe("submitPrimaryDomain", () => {
	it("posts the domain from the form (ok=true)", async () => {
		const body = { redirect: "/onboarding" };
		fetchMock.mockResolvedValue(jsonResponse(true, body));
		const form = new FormData();
		form.set("domain", "example.com");

		const result = await submitPrimaryDomain(form);

		expect(result).toEqual({ ok: true, data: body });
		expect(fetchMock).toHaveBeenCalledWith("/api/setup/domain", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ hostname: "example.com" }),
		});
	});

	it("reports ok=false when the request fails", async () => {
		fetchMock.mockResolvedValue(jsonResponse(false, { error: "bad" }));
		const result = await submitPrimaryDomain(new FormData());
		expect(result.ok).toBe(false);
		expect(result.data).toEqual({ error: "bad" });
	});
});

describe("submitRegistration", () => {
	function form() {
		const f = new FormData();
		f.set("username", "alice");
		f.set("password", "secret");
		f.set("resetEmail", "alice@example.com");
		return f;
	}

	it("includes the domain in the body on first run and stores the token", async () => {
		fetchMock.mockResolvedValue(jsonResponse(true, { token: "tok", redirect: "/inbox" }));

		const result = await submitRegistration(form(), {
			firstRun: true,
			domain: "example.com",
			inviteToken: null,
		});

		expect(fetchMock).toHaveBeenCalledWith("/api/auth/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				domain: "example.com",
				username: "alice",
				password: "secret",
				resetEmail: "alice@example.com",
			}),
		});
		expect(storage.setItem).toHaveBeenCalledWith("lumimail-session-token", "tok");
		expect(result).toEqual({ ok: true, data: { redirect: "/inbox", error: undefined } });
	});

	it("omits the domain when not first run and includes the invite token", async () => {
		fetchMock.mockResolvedValue(jsonResponse(true, {}));

		await submitRegistration(form(), {
			firstRun: false,
			domain: "ignored.com",
			inviteToken: "inv_1",
		});

		const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(sentBody).toEqual({
			username: "alice",
			password: "secret",
			resetEmail: "alice@example.com",
			inviteToken: "inv_1",
		});
	});

	it("does not store a token when the response is not ok", async () => {
		fetchMock.mockResolvedValue(jsonResponse(false, { token: "tok", error: "nope" }));

		const result = await submitRegistration(form(), {
			firstRun: false,
			domain: "x",
			inviteToken: null,
		});

		expect(storage.setItem).not.toHaveBeenCalled();
		expect(result).toEqual({ ok: false, data: { redirect: undefined, error: "nope" } });
	});

	it("does not store a token when token is not a string", async () => {
		fetchMock.mockResolvedValue(jsonResponse(true, { token: 123, redirect: 456 }));

		const result = await submitRegistration(form(), {
			firstRun: false,
			domain: "x",
			inviteToken: null,
		});

		expect(storage.setItem).not.toHaveBeenCalled();
		expect(result.data).toEqual({ redirect: undefined, error: undefined });
	});

	it("swallows localStorage errors when storing the token", async () => {
		storage.setItem.mockImplementation(() => {
			throw new Error("denied");
		});
		fetchMock.mockResolvedValue(jsonResponse(true, { token: "tok" }));

		await expect(
			submitRegistration(form(), { firstRun: false, domain: "x", inviteToken: null }),
		).resolves.toEqual({ ok: true, data: { redirect: undefined, error: undefined } });
	});
});

describe("getInviteInfo", () => {
	it("returns the invite data on success", async () => {
		const data = { email: "a@b.com", orgName: "Acme", role: "member" };
		fetchMock.mockResolvedValue(jsonResponse(true, { success: true, data }));

		await expect(getInviteInfo("tok")).resolves.toEqual(data);
		expect(fetchMock).toHaveBeenCalledWith("/api/org/invites/tok");
	});

	it("throws the provided error message when the response is not ok", async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(false, { success: false, error: { message: "expired" } }),
		);
		await expect(getInviteInfo("tok")).rejects.toThrow("expired");
	});

	it("throws when success is false", async () => {
		fetchMock.mockResolvedValue(jsonResponse(true, { success: false }));
		await expect(getInviteInfo("tok")).rejects.toThrow("Invite not found");
	});

	it("falls back to the default message when no error is present", async () => {
		fetchMock.mockResolvedValue(jsonResponse(false, { success: false }));
		await expect(getInviteInfo("tok")).rejects.toThrow("Invite not found");
	});
});
