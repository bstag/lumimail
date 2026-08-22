import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
	return readFileSync(path.join(root, relativePath), "utf8");
}

describe("CRAP quality gate", () => {
	it("defines the pinned analyzer and local threshold command", () => {
		const packageJson = JSON.parse(read("package.json")) as {
			scripts: Record<string, string>;
			devDependencies: Record<string, string>;
		};

		expect(packageJson.devDependencies["@barney-media/crap-typescript"]).toBe("0.5.0");
		expect(packageJson.scripts["crap:coverage"]).toBe(
			"vitest run --coverage --config vitest.crap.config.ts",
		);
		expect(packageJson.scripts.crap).toBe(
			"npm run crap:coverage && crap-typescript --threshold 30 --format text --failures-only",
		);
		expect(packageJson.scripts["crap:report"]).toBe(
			"crap-typescript --threshold 30 --format text",
		);
		expect(packageJson.scripts.verify).toContain("npm run test:cov && npm run crap");
	});

	it("defines a dedicated all-source coverage pass without weakening the unit gate", () => {
		const unitConfig = read("vitest.config.ts");
		const crapConfig = read("vitest.crap.config.ts");

		expect(unitConfig).toContain('thresholds: {');
		expect(unitConfig).toContain('lines: 100');
		expect(unitConfig).toContain('"**/*.tsx"');
		expect(crapConfig).toContain('include: ["src/**/*.ts", "src/**/*.tsx"]');
		expect(crapConfig).toContain('exclude: ["**/*.d.ts"]');
		expect(crapConfig).toContain('reporter: ["json"]');
		expect(crapConfig).toContain('"tests/unit/db/migrations.test.ts"');
		expect(crapConfig).not.toContain("thresholds:");
	});

	it("runs the CRAP gate in CI after coverage", () => {
		const workflow = read(".github/workflows/ci.yml");
		const coverageStep = workflow.indexOf("npm run test:cov");
		const crapStep = workflow.indexOf("npm run crap");

		expect(coverageStep).toBeGreaterThan(-1);
		expect(crapStep).toBeGreaterThan(coverageStep);
	});

	it("documents local usage and the enforced threshold", () => {
		const guide = read("docs/tests/README.md");

		expect(guide).toContain("npm run crap");
		expect(guide).toContain("CRAP score above 30");
	});
});
