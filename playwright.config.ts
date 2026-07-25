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
	testDir: "./tests",
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
		// Mocked suite: fast, hermetic, no data setup. Run by `npm run e2e`.
		{ name: "chromium", testDir: "./tests/e2e", use: { ...devices["Desktop Chrome"] } },
		// Authenticated suite against the real local backend. Requires a restored
		// local database seeded by `scripts/seed-e2e.mjs`, which `npm run e2e:local`
		// does first. Kept a separate project so the mocked suite stays runnable
		// with no local data at all.
		// Serial: these share one local database and one dev server, so parallel
		// workers contend on route compilation and on the same rows.
		// Signs in once per role and saves session state, so the suite does not trip
		// the login rate limiter (five attempts per minute per IP).
		{
			name: "local-setup",
			testDir: "./tests/e2e-local",
			testMatch: /auth\.setup\.ts/,
			timeout: 120_000,
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "local",
			testDir: "./tests/e2e-local",
			testIgnore: /auth\.setup\.ts/,
			dependencies: ["local-setup"],
			fullyParallel: false,
			// The first test to touch a route waits for the dev server to compile it,
			// which can exceed the default 30s budget. The cost is the dev server's,
			// not the application's — a production build responds immediately — so
			// the allowance is here rather than the tests being made less strict.
			timeout: 120_000,
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: devServerCommand,
		url: readinessURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
