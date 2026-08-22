import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Coverage input for repository-wide CRAP analysis.
 *
 * Unlike the incremental 100% gate in `vitest.config.ts`, this pass instruments
 * every executable TypeScript/TSX source file and deliberately has no percentage
 * threshold. Untested functions therefore appear with zero coverage and receive a
 * pessimistic CRAP score instead of being omitted or reported as N/A.
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
		testTimeout: 30000,
		include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
		// Wrangler's local D1 migration suite opens a loopback server and is already
		// exercised by the ordinary coverage gate. Re-running it in this second,
		// instrumentation-only pass can exhaust Windows socket buffers.
		exclude: ["tests/e2e/**", "tests/unit/db/migrations.test.ts", "node_modules/**"],
		setupFiles: [],
		coverage: {
			provider: "v8",
			reporter: ["json"],
			reportsDirectory: "./coverage",
			include: ["src/**/*.ts", "src/**/*.tsx"],
			exclude: ["**/*.d.ts"],
		},
	},
});
