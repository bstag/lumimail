import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit/integration test runner config.
 *
 * Coverage is enforced at 100% (lines, functions, statements, branches) on the
 * files listed in `coverage.include`. The protocol target is 100% across all of
 * `src/`; we grow the include list as modules gain tests rather than lowering the
 * threshold. See docs/tests/README.md for the expansion process.
 *
 * E2E tests live in tests/e2e and run under Playwright, not Vitest — they are
 * excluded here.
 */
export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		environment: "node",
		globals: true,
		// Some unit tests exercise bcrypt hashing in tight loops (see
		// tests/unit/lib/api-keys.test.ts). bcrypt.hashSync at cost 10 is ~100ms
		// per call, so batches can exceed the 5s default on slower CI runners.
		testTimeout: 30000,
		include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
		exclude: ["tests/e2e/**", "node_modules/**"],
		setupFiles: [],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "lcov"],
			reportsDirectory: "./coverage",
			include: [
				"src/lib/validators.ts",
				"src/lib/ids.ts",
				"src/app/utils.ts",
				"src/lib/utils.ts",
				"src/lib/api-keys.ts",
				"src/lib/dns-status.ts",
				"src/lib/email/address.ts",
				"src/lib/email/reply-content-utils.ts",
				"src/lib/email/alias-targets.ts",
				"src/lib/email/providers/index.ts",
				"src/lib/email/providers/cloudflare.ts",
				"src/lib/email/providers/resend.ts",
			],
			thresholds: {
				lines: 100,
				functions: 100,
				statements: 100,
				branches: 100,
			},
		},
	},
});
