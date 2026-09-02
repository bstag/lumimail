import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => readFileSync(path.join(root, ...segments), "utf8");

describe("Picket application shells", () => {
	it("uses the shared lockup and restrained route motif on pre-authentication surfaces", () => {
		const authShell = read("src", "components", "auth", "auth-shell.tsx");
		const landing = read("src", "app", "page.tsx");

		expect(authShell).toContain("BrandLockup");
		expect(authShell).toContain("RouteMotif");
		expect(landing).toContain("Own the route. Control the inbox.");
		expect(landing).toContain("RouteMotif");
	});

	it("identifies both authenticated shells without adding motifs to dense mail surfaces", () => {
		const dashboard = read("src", "app", "(dashboard)", "layout.tsx");
		const settings = read("src", "app", "(settings)", "layout.tsx");

		expect(dashboard).toContain('data-app-shell="mail"');
		expect(settings).toContain('data-app-shell="settings"');
		expect(dashboard).not.toContain("RouteMotif");
		expect(settings).not.toContain("RouteMotif");
	});

	it("uses semantic foregrounds and a distinct route marker in navigation", () => {
		const navItem = read("src", "components", "components-nav.tsx");
		const mobileTabs = read("src", "components", "mobile-tab-bar.tsx");

		expect(navItem).toContain("text-accent-ink");
		expect(navItem).toContain("bg-brand-signal");
		expect(mobileTabs).toContain("bg-brand-signal");
	});
});
