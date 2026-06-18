import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/seed-utils", () => ({
	ensureDemoUser: vi.fn(),
	ensureDemoDomain: vi.fn(),
	ensureDemoMailboxes: vi.fn(),
	insertDemoMessages: vi.fn(),
}));
vi.mock("@/lib/migration/backfill-orgs", () => ({ ensureUserOrg: vi.fn() }));

import {
	ensureDemoDomain,
	ensureDemoMailboxes,
	ensureDemoUser,
	insertDemoMessages,
} from "@/lib/seed-utils";
import { ensureUserOrg } from "@/lib/migration/backfill-orgs";
import { seedDemoData } from "@/lib/seed";

const env = {} as CloudflareEnv;

beforeEach(() => {
	vi.mocked(ensureDemoUser).mockResolvedValue({ id: "u1" } as Awaited<ReturnType<typeof ensureDemoUser>>);
	vi.mocked(ensureUserOrg).mockResolvedValue("org_1");
	vi.mocked(ensureDemoDomain).mockResolvedValue({ id: "d1" } as Awaited<ReturnType<typeof ensureDemoDomain>>);
	vi.mocked(ensureDemoMailboxes).mockResolvedValue({} as Awaited<ReturnType<typeof ensureDemoMailboxes>>);
	vi.mocked(insertDemoMessages).mockResolvedValue(5);
});

describe("seedDemoData", () => {
	it("orchestrates seeding and returns the message count", async () => {
		const result = await seedDemoData(env);
		expect(result).toEqual({ messageCount: 5 });
		expect(ensureUserOrg).toHaveBeenCalledWith(env, "u1");
		expect(ensureDemoDomain).toHaveBeenCalledWith(env, "u1");
		expect(ensureDemoMailboxes).toHaveBeenCalledWith(env, "u1", "d1");
		expect(insertDemoMessages).toHaveBeenCalledWith(env, "u1", {});
	});
});
