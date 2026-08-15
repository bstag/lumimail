import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ list: vi.fn(), user: { id: "usr_1" } as any, env: {} as CloudflareEnv }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => h.env }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/mcp/connections", () => ({ listMcpConnections: h.list }));

import { GET } from "@/app/api/mcp/connections/route";

beforeEach(() => {
	vi.clearAllMocks();
	h.user = { id: "usr_1" };
	h.list.mockResolvedValue({ connections: [] });
});

describe("GET /api/mcp/connections", () => {
	it("returns only the current user's connection inventory", async () => {
		const response = await GET(new Request("https://mail.example/api/mcp/connections"));
		expect(response.status).toBe(200);
		expect(h.list).toHaveBeenCalledWith(h.env, "usr_1");
	});
});
