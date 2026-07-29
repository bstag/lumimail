import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Wrangler local binding contract", () => {
	it("keeps browser tests local and retains the deployed email binding", () => {
		const config = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
		const exampleConfig = readFileSync(
			resolve(process.cwd(), "wrangler.jsonc.example"),
			"utf8",
		);
		const playwrightConfig = readFileSync(
			resolve(process.cwd(), "playwright.config.ts"),
			"utf8",
		);
		const serverSetup = readFileSync(resolve(process.cwd(), "tests/e2e-server.ts"), "utf8");
		const nextConfig = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

		expect(config).toContain('"send_email"');
		expect(config).toContain('"name": "EMAIL"');
		expect(config).not.toContain('"remote": true');
		expect(exampleConfig).toContain('"name": "EMAIL"');
		expect(exampleConfig).not.toContain('"remote": true');
		expect(playwrightConfig).toContain('globalSetup: "./tests/e2e-server.ts"');
		expect(serverSetup).toContain("XDG_CONFIG_HOME");
		expect(serverSetup).toContain('.wrangler", "playwright-config');
		expect(serverSetup).toContain("LUMIMAIL_CLOUDFLARE_DEV");
		expect(serverSetup).toContain('npm_lifecycle_event === "e2e:local"');
		expect(serverSetup).toContain('"taskkill"');
		expect(nextConfig).toContain('process.env.LUMIMAIL_CLOUDFLARE_DEV !== "false"');
	});
});
