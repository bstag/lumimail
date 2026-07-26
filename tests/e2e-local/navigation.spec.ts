import { expect, test, type Page } from "@playwright/test";
import { OWNER_STATE, VIEWER_STATE } from "./auth-paths";

/**
 * Navigation ergonomics (F69), against the real backend.
 *
 * The rail and the tab bar are both easy to get *nearly* right — a rail whose icons
 * have lost their names, or a bar that is merely hidden at desktop rather than absent.
 * Both failures look correct in a screenshot, so they are asserted directly.
 */

/** Width of the shell's first grid column, which is the sidebar. */
async function sidebarWidth(page: Page): Promise<number> {
	return page.evaluate(() => {
		const aside = document.querySelector("aside");
		return aside ? Math.round(aside.getBoundingClientRect().width) : -1;
	});
}

test.describe("the desktop sidebar collapses to a rail", () => {
	test.use({ storageState: OWNER_STATE });

	test("narrows the sidebar and gives the width to the content", async ({ page }) => {
		await page.goto("/inbox");
		await page.waitForSelector('[placeholder="Search mail"]');

		const expanded = await sidebarWidth(page);
		const contentExpanded = await page.evaluate(
			() => Math.round(document.querySelector("main")!.getBoundingClientRect().width),
		);

		await page.getByRole("button", { name: "Collapse navigation" }).click();
		await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();

		const collapsed = await sidebarWidth(page);
		const contentCollapsed = await page.evaluate(
			() => Math.round(document.querySelector("main")!.getBoundingClientRect().width),
		);

		expect(collapsed).toBeLessThan(expanded);
		// The point of the feature: the space has to go to the content, not vanish.
		expect(contentCollapsed).toBeGreaterThan(contentExpanded);
	});

	test("keeps every destination named while collapsed", async ({ page }) => {
		await page.goto("/inbox");
		await page.getByRole("button", { name: "Collapse navigation" }).click();
		await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();

		// A rail of unnamed icons is unusable with a screen reader. The labels are
		// hidden visually, not removed, so the accessible names survive.
		for (const name of ["Inbox", "Sent", "Drafts", "Starred", "Spam", "Trash"]) {
			await expect(page.getByRole("link", { name })).toHaveCount(1);
		}
	});

	test("remembers the choice across a reload", async ({ page }) => {
		await page.goto("/inbox");
		await page.getByRole("button", { name: "Collapse navigation" }).click();
		await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();

		await page.reload();
		await page.waitForSelector('[placeholder="Search mail"]');

		await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();

		// Restore, so the stored preference does not leak into the tests below.
		await page.getByRole("button", { name: "Expand navigation" }).click();
		await expect(page.getByRole("button", { name: "Collapse navigation" })).toBeVisible();
	});

	test("offers no tab bar at desktop, so no destination is named twice", async ({ page }) => {
		await page.goto("/inbox");
		await page.waitForSelector('[placeholder="Search mail"]');

		// Not "is hidden" — absent. A CSS-hidden bar still duplicates every link in the
		// accessibility tree and makes strict locators ambiguous.
		for (const name of ["Inbox", "Sent", "Drafts", "Starred"]) {
			await expect(page.getByRole("link", { name })).toHaveCount(1);
		}
	});
});

test.describe("a phone gets a bottom tab bar", () => {
	test.use({ storageState: OWNER_STATE, viewport: { width: 390, height: 844 } });

	test("offers the most-used folders in one tap", async ({ page }) => {
		await page.goto("/inbox");
		await page.waitForSelector('[placeholder="Search mail"]');

		const bar = page.getByRole("navigation", { name: "Mail" });
		await expect(bar).toBeVisible();
		for (const name of ["Inbox", "Sent", "Drafts", "Starred"]) {
			await expect(bar.getByRole("link", { name })).toBeVisible();
		}
	});

	test("navigates without opening the drawer", async ({ page }) => {
		await page.goto("/inbox");
		await page.waitForSelector('[placeholder="Search mail"]');

		await page.getByRole("navigation", { name: "Mail" }).getByRole("link", { name: "Sent" }).click();
		await expect(page).toHaveURL(/\/sent$/);
	});

	test("reaches everything else through More", async ({ page }) => {
		await page.goto("/inbox");
		await page.waitForSelector('[placeholder="Search mail"]');

		// Labels is deliberately not on the bar, so it proves the overflow path.
		await page.getByRole("button", { name: "More" }).click();
		await page.getByRole("link", { name: "Labels" }).click();
		await expect(page).toHaveURL(/\/labels$/);
	});

	test("does not cover the end of the page", async ({ page }) => {
		await page.goto("/inbox");
		await page.waitForSelector('[placeholder="Search mail"]');

		const overlap = await page.evaluate(() => {
			const nav = document.querySelector('nav[aria-label]');
			const main = document.querySelector("main");
			if (!nav || !main) return null;
			const navTop = nav.getBoundingClientRect().top;
			const contentBottom = main.getBoundingClientRect().bottom;
			return { navTop, contentBottom };
		});

		expect(overlap).not.toBeNull();
		// The content box may extend under the bar, but its padding must reserve the
		// bar's height so the last row is never hidden beneath it.
		const reserved = await page.evaluate(
			() => Number.parseFloat(getComputedStyle(document.querySelector("main")!).paddingBottom),
		);
		expect(reserved).toBeGreaterThanOrEqual(56);
	});
});

test.describe("the tab bar respects capability", () => {
	test.use({ storageState: VIEWER_STATE, viewport: { width: 390, height: 844 } });

	test("offers a viewer no Drafts and no gap where it would be", async ({ page }) => {
		await page.goto("/inbox");
		await page.waitForSelector('[placeholder="Search mail"]');

		const bar = page.getByRole("navigation", { name: "Mail" });
		await expect(bar).toBeVisible();
		await expect(bar.getByRole("link", { name: "Drafts" })).toHaveCount(0);

		// The slot is filled by the next destination in priority order rather than left
		// empty, so the viewer still gets a full bar.
		await expect(bar.getByRole("link")).toHaveCount(4);
	});
});
