import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/db";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ getDb: () => h.db }));

import { authorizeMcpRequest } from "@/lib/mcp/auth";

function tokenSummary(overrides: Record<string, unknown> = {}) {
	return {
		userId: "usr_1",
		expiresAt: 2_000_000_000,
		audience: "https://mail.example.com/mcp",
		scope: ["mail.read"],
		grant: {
			clientId: "client_1",
			props: {
				connectionId: "mcp_1",
				userId: "usr_1",
				organizationId: "org_1",
				sessionId: "sess_1",
			},
		},
		...overrides,
	};
}

describe("authorizeMcpRequest", () => {
	let mock: ReturnType<typeof createDbMock>;
	let unwrapToken: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mock = createDbMock();
		h.db = mock.db;
		unwrapToken = vi.fn();
	});

	function env() {
		return { OAUTH_PROVIDER: { unwrapToken } } as never;
	}

	it("denies absent, invalid, and scope-less bearer credentials before D1", async () => {
		await expect(authorizeMcpRequest(env(), new Request("https://mail.example.com/mcp"))).resolves.toBeNull();
		const whitespaceBearer = { headers: { get: () => "Bearer    " } } as unknown as Request;
		await expect(authorizeMcpRequest(env(), whitespaceBearer)).resolves.toBeNull();
		unwrapToken.mockResolvedValueOnce(null).mockResolvedValueOnce(tokenSummary({ scope: [] }));
		for (const token of ["missing", "scope-less"]) {
			await expect(authorizeMcpRequest(env(), new Request("https://mail.example.com/mcp", {
				headers: { authorization: `Bearer ${token}` },
			}))).resolves.toBeNull();
		}
		expect(mock.db.select).not.toHaveBeenCalled();
	});

	it("denies a malformed or mismatched encrypted grant binding", async () => {
		unwrapToken
			.mockResolvedValueOnce(tokenSummary({ grant: { clientId: "client_1", props: null } }))
			.mockResolvedValueOnce(tokenSummary({ grant: { clientId: "client_1", props: { connectionId: "", userId: 1, organizationId: "org_1", sessionId: "sess_1" } } }))
			.mockResolvedValueOnce(tokenSummary({ userId: "usr_2" }));
		for (const token of ["malformed", "empty", "mismatch"]) {
			await expect(authorizeMcpRequest(env(), new Request("https://mail.example.com/mcp", {
				headers: { authorization: `Bearer ${token}` },
			}))).resolves.toBeNull();
		}
	});

	it("supports array and absent audiences without broadening the binding", async () => {
		unwrapToken
			.mockResolvedValueOnce(tokenSummary({ audience: ["https://mail.example.com/mcp"] }))
			.mockResolvedValueOnce(tokenSummary({ audience: undefined }));
		mock.queueSelect([{ connectionId: "mcp_1" }]).queueSelect([{ connectionId: "mcp_1" }]);
		const request = new Request("https://mail.example.com/mcp", { headers: { authorization: "Bearer valid" } });
		expect((await authorizeMcpRequest(env(), request))?.resource?.href).toBe("https://mail.example.com/mcp");
		expect(await authorizeMcpRequest(env(), request)).not.toHaveProperty("resource");
	});

	it("denies a revoked/sessionless membership and returns an active exact binding", async () => {
		unwrapToken.mockResolvedValue(tokenSummary());
		mock.queueSelect([]).queueSelect([{ connectionId: "mcp_1" }]);
		const request = new Request("https://mail.example.com/mcp", {
			headers: { authorization: "Bearer valid-token" },
		});
		await expect(authorizeMcpRequest(env(), request)).resolves.toBeNull();
		await expect(authorizeMcpRequest(env(), request, new Date(1_000))).resolves.toMatchObject({
			token: "valid-token",
			clientId: "client_1",
			scopes: ["mail.read"],
			resource: new URL("https://mail.example.com/mcp"),
			props: { connectionId: "mcp_1", sessionId: "sess_1" },
		});
		expect(mock.updates).toHaveLength(1);
	});
});
