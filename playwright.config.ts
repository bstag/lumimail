import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? "3000";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const readinessURL = new URL("/manifest.webmanifest", baseURL).toString();
const devServerCommand = process.env.PLAYWRIGHT_DEV_SERVER_COMMAND ?? `npm run dev -- --port ${port}`;

/**
 * E2E config. Tests boot the Next.js dev server against a local D1/SQLite
 * binding (via `wrangler dev` semantics through `next dev`). See
 * docs/tests/README.md for how local data is seeded before a run.
 */
export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: "list",
	use: {
		baseURL,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
	],
	webServer: {
		command: devServerCommand,
		url: readinessURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
