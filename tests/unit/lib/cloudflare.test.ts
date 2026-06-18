import { describe, expect, it, vi } from "vitest";

const getCloudflareContext = vi.fn();
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => getCloudflareContext() }));

import { getEnv } from "@/lib/cloudflare";

describe("getEnv", () => {
	it("returns the env from the Cloudflare context", () => {
		const env = { DB: {}, CF_TOKEN: "t" };
		getCloudflareContext.mockReturnValue({ env });
		expect(getEnv()).toBe(env);
	});
});
