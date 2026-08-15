import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));
vi.mock("@/lib/ids", () => ({ newId: (prefix?: string) => `${prefix ?? "id"}_fixed` }));

import {
	approveMcpConnection,
	denyMcpAuthorization,
	inspectMcpAuthorization,
	listMcpConnections,
	revokeMcpConnection,
} from "@/lib/mcp/connections";

const authRequest = {
	responseType: "code",
	clientId: "client_1",
	redirectUri: "https://client.example/callback",
	scope: ["mail.read", "mail.actions"],
	state: "opaque",
	codeChallenge: "challenge",
	codeChallengeMethod: "S256",
	resource: "https://mail.example/mcp",
};

describe("MCP connection lifecycle", () => {
	let mock: ReturnType<typeof createDbMock>;
	let provider: {
		parseAuthRequest: ReturnType<typeof vi.fn>;
		lookupClient: ReturnType<typeof vi.fn>;
		completeAuthorization: ReturnType<typeof vi.fn>;
		listUserGrants: ReturnType<typeof vi.fn>;
		revokeGrant: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		mock = createDbMock();
		h.db = mock.db;
		provider = {
			parseAuthRequest: vi.fn().mockResolvedValue(authRequest),
			lookupClient: vi.fn().mockResolvedValue({ clientId: "client_1", clientName: " Agent Client " }),
			completeAuthorization: vi.fn().mockResolvedValue({ redirectTo: "https://client.example/callback?code=opaque" }),
			listUserGrants: vi.fn().mockResolvedValue({ items: [] }),
			revokeGrant: vi.fn().mockResolvedValue(undefined),
		};
	});

	function env() {
		return { OAUTH_PROVIDER: provider } as never;
	}

	it("validates the provider request and presents a read-default client summary", async () => {
		await expect(inspectMcpAuthorization(env(), new Request("https://mail.example/oauth/authorize?x=1")))
			.resolves.toEqual({ clientName: "Agent Client", requestedScopes: ["mail.read", "mail.actions"], defaultProfile: "read" });
	});

	it("rejects an unknown client and uses a bounded fallback client name", async () => {
		provider.lookupClient.mockResolvedValueOnce(null);
		await expect(inspectMcpAuthorization(env(), new Request("https://mail.example/oauth/authorize")))
			.rejects.toThrow("Unknown OAuth client");
		provider.lookupClient.mockResolvedValueOnce({ clientId: "client_1" });
		await expect(inspectMcpAuthorization(env(), new Request("https://mail.example/oauth/authorize")))
			.resolves.toMatchObject({ clientName: "OAuth client" });
	});

	it("builds denial only from a provider-validated redirect", async () => {
		provider.parseAuthRequest.mockResolvedValue({ ...authRequest, issuer: "https://mail.example" });
		await expect(denyMcpAuthorization(env(), new Request("https://mail.example/oauth/authorize?x=1")))
			.resolves.toEqual({
				redirectTo: "https://client.example/callback?error=access_denied&error_description=The+user+denied+the+authorization+request&state=opaque&iss=https%3A%2F%2Fmail.example",
			});
	});

	it("omits optional denial state and issuer", async () => {
		provider.parseAuthRequest.mockResolvedValue({ ...authRequest, state: undefined });
		const result = await denyMcpAuthorization(env(), new Request("https://mail.example/oauth/authorize"));
		expect(result.redirectTo).not.toContain("state=");
		expect(result.redirectTo).not.toContain("iss=");
	});

	it("persists pending before OAuth completion and activates with content-free audit", async () => {
		const result = await approveMcpConnection(env(), {
			request: new Request("https://mail.example/oauth/authorize?x=1"),
			userId: "usr_1",
			organizationId: "org_1",
			sessionId: "sess_1",
			profile: "actions",
			requestId: "req_1",
			now: new Date(1_000),
		});

		expect(result).toEqual({ redirectTo: "https://client.example/callback?code=opaque", connectionId: "mcp_fixed" });
		expect(mock.inserts[0].values).toMatchObject({
			id: "mcp_fixed", userId: "usr_1", organizationId: "org_1", approvingSessionId: "sess_1",
			clientId: "client_1", clientName: "Agent Client", profile: "actions", status: "pending",
		});
		expect(provider.completeAuthorization).toHaveBeenCalledWith(expect.objectContaining({
			userId: "usr_1",
			scope: ["mail.read", "mail.actions"],
			props: { connectionId: "mcp_fixed", userId: "usr_1", organizationId: "org_1", sessionId: "sess_1" },
			revokeExistingGrants: false,
		}));
		expect(mock.db.batch).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(mock.inserts.at(-1)?.values)).not.toMatch(/client|scope|token|email|body|query/i);
	});

	it("removes a pending projection when provider completion fails", async () => {
		provider.completeAuthorization.mockRejectedValue(new Error("provider unavailable"));
		await expect(approveMcpConnection(env(), {
			request: new Request("https://mail.example/oauth/authorize?x=1"),
			userId: "usr_1", organizationId: "org_1", sessionId: "sess_1", profile: "read", requestId: "req_1",
		})).rejects.toThrow("provider unavailable");
		expect(mock.deletes).toHaveLength(1);
	});

	it("lists only the user's secret-free rows", async () => {
		mock.queueSelect([{ id: "mcp_1", clientName: "Agent", profile: "read", status: "active", createdAt: new Date(1), lastUsedAt: null, revokedAt: null }]);
		await expect(listMcpConnections(env(), "usr_1")).resolves.toEqual({ connections: [{
			id: "mcp_1", clientName: "Agent", profile: "read", status: "active",
			createdAt: new Date(1).toISOString(), lastUsedAt: null, revokedAt: null,
		}] });
	});

	it("revokes the correlated provider grant before marking an owned connection revoked", async () => {
		mock.queueSelect([{ id: "mcp_1", organizationId: "org_1", status: "active" }]);
		provider.listUserGrants.mockResolvedValue({ items: [
			{ id: "grant_1", metadata: { connectionId: "mcp_1" } },
			{ id: "grant_other", metadata: { connectionId: "mcp_2" } },
		] });
		await expect(revokeMcpConnection(env(), {
			connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1", requestId: "req_2", now: new Date(2_000),
		})).resolves.toEqual({ status: "revoked" });
		expect(provider.revokeGrant).toHaveBeenCalledOnce();
		expect(provider.revokeGrant).toHaveBeenCalledWith("grant_1", "usr_1");
		expect(mock.db.batch).toHaveBeenCalledOnce();
	});

	it("handles missing, already-revoked, and non-correlating lifecycle rows safely", async () => {
		mock.queueSelect([]);
		await expect(revokeMcpConnection(env(), {
			connectionId: "missing", userId: "usr_1", organizationId: "org_1", requestId: "req_2",
		})).resolves.toEqual({ status: "not-found" });

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([{ id: "mcp_1", organizationId: "org_1", status: "revoked" }]);
		provider.listUserGrants.mockResolvedValue({ items: [
			{ id: "g1", metadata: null },
			{ id: "g2", metadata: "invalid" },
			{ id: "g3", metadata: { connectionId: 123 } },
		] });
		await expect(revokeMcpConnection(env(), {
			connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1", requestId: "req_3",
		})).resolves.toEqual({ status: "revoked" });
		expect(provider.revokeGrant).not.toHaveBeenCalled();
		expect(mock.db.batch).not.toHaveBeenCalled();

		mock = createDbMock(); h.db = mock.db;
		mock.queueSelect([{ id: "mcp_2", organizationId: "org_1", status: "active" }]);
		provider.listUserGrants.mockResolvedValue({ items: [] });
		await revokeMcpConnection(env(), {
			connectionId: "mcp_2", userId: "usr_1", organizationId: "org_1", requestId: "req_4",
		});
		expect(mock.db.batch).toHaveBeenCalledOnce();
	});

	it("fails closed before D1 revocation when provider grant enumeration exceeds its bound", async () => {
		mock.queueSelect([{ id: "mcp_1", organizationId: "org_1", status: "active" }]);
		provider.listUserGrants.mockResolvedValue({ items: [], cursor: "more" });
		await expect(revokeMcpConnection(env(), {
			connectionId: "mcp_1", userId: "usr_1", organizationId: "org_1", requestId: "req_2",
		})).rejects.toThrow("Too many OAuth grants to revoke safely");
		expect(provider.listUserGrants).toHaveBeenCalledTimes(5);
		expect(mock.db.batch).not.toHaveBeenCalled();
	});
});
