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
			// Gate ALL logic files: every TS module under src/lib, every API route
			// handler + colocated `utils.ts`, and component `*-utils.ts` helpers.
			// React views (`.tsx` pages/components) are out of scope for unit
			// coverage (exercised by Playwright E2E). Vitest's `all` defaults to
			// true, so an untested file in these globs fails CI at 0%, not just
			// imported ones.
			include: ["src/lib/**/*.ts", "src/app/**/*.ts", "src/components/**/*-utils.ts"],
			exclude: [
				"**/*.d.ts",
				// Type-only module (no runtime statements).
				"src/lib/email/providers/types.ts",
				// Pure re-export barrel (no own executable statements to cover).
				"src/app/(admin)/api-keys/utils.ts",
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
