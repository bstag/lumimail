import { describe, expect, it } from "vitest";
import type { NavLink } from "@/components/components-nav";
import {
	MOBILE_TAB_LIMIT,
	MOBILE_TAB_PRIORITY,
	selectMobileTabs,
} from "@/components/mobile-tab-bar-utils";

/** The mail nav as a send-capable user sees it, in its own order. */
const SEND_CAPABLE: NavLink[] = [
	{ href: "/compose", label: "Compose", primary: true },
	{ href: "/inbox", label: "Inbox" },
	{ href: "/sent", label: "Sent" },
	{ href: "/drafts", label: "Drafts" },
	{ href: "/starred", label: "Starred" },
	{ href: "/spam", label: "Spam" },
	{ href: "/trash", label: "Trash" },
	{ href: "/labels", label: "Labels" },
	{ break: true },
	{ href: "/settings", label: "Settings" },
];

/** The same nav for a viewer: no Compose, no Drafts. */
const VIEWER: NavLink[] = SEND_CAPABLE.filter(
	(link) => link.href !== "/compose" && link.href !== "/drafts",
);

describe("selectMobileTabs", () => {
	it("carries the most-used folders for a send-capable user", () => {
		expect(selectMobileTabs(SEND_CAPABLE).map((link) => link.href)).toEqual([
			"/inbox",
			"/sent",
			"/drafts",
			"/starred",
		]);
	});

	it("fills the gap rather than leaving one when a capability is missing", () => {
		// A viewer has no Drafts. The bar must not render a hole where it would be.
		const hrefs = selectMobileTabs(VIEWER).map((link) => link.href);
		expect(hrefs).not.toContain("/drafts");
		expect(hrefs).toEqual(["/inbox", "/sent", "/starred", "/spam"]);
	});

	it("never exceeds the limit", () => {
		expect(selectMobileTabs(SEND_CAPABLE)).toHaveLength(MOBILE_TAB_LIMIT);
		expect(selectMobileTabs(SEND_CAPABLE, 2)).toHaveLength(2);
	});

	it("returns fewer than the limit rather than inventing destinations", () => {
		const sparse: NavLink[] = [{ href: "/inbox", label: "Inbox" }];
		expect(selectMobileTabs(sparse).map((link) => link.href)).toEqual(["/inbox"]);
	});

	it("ignores separators and anything without a destination", () => {
		const withBreaks: NavLink[] = [{ break: true }, { label: "orphan" }, ...SEND_CAPABLE];
		expect(selectMobileTabs(withBreaks).every((link) => link.href)).toBe(true);
	});

	it("orders by priority, not by the nav's own order", () => {
		// Stability matters: gaining send capability should slot Drafts in, not
		// reshuffle the whole bar under the user's thumb.
		const reversed = [...SEND_CAPABLE].reverse();
		expect(selectMobileTabs(reversed).map((link) => link.href)).toEqual([
			"/inbox",
			"/sent",
			"/drafts",
			"/starred",
		]);
	});

	it("never offers a destination the nav did not", () => {
		const hrefs = new Set(SEND_CAPABLE.map((link) => link.href));
		for (const tab of selectMobileTabs(SEND_CAPABLE)) {
			expect(hrefs.has(tab.href)).toBe(true);
		}
	});

	it("returns nothing for an empty nav", () => {
		expect(selectMobileTabs([])).toEqual([]);
	});

	it("keeps the priority list free of duplicates", () => {
		expect(new Set(MOBILE_TAB_PRIORITY).size).toBe(MOBILE_TAB_PRIORITY.length);
	});
});
