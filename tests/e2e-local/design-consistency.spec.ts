import { expect, test, type Page } from "@playwright/test";
import { OWNER_STATE } from "./auth-paths";

/**
 * Geometry contracts for F68.
 *
 * These assert **computed styles in a real browser**, not class strings. Every defect
 * F68 fixes was invisible in the source — `h-10` on a select and `h-9` on an input
 * both read as reasonable until you measure them side by side — so reading classes
 * would reproduce the blind spot rather than close it.
 *
 * They are contracts, not snapshots: each asserts that things which should agree do
 * agree, never that a particular value is used. A deliberate restyle keeps them green;
 * drift breaks them.
 */

const ADMIN_PAGES = ["/mailboxes", "/domains", "/routing", "/members", "/aliases", "/webhooks", "/api-keys"];
const FORM_PAGES = ["/routing", "/settings", "/aliases", "/filters", "/members"];

interface Control {
	tag: string;
	h: number;
	radius: string;
	borderColor: string;
	borderWidth: string;
	background: string;
}

/** Collects the geometry of every visible form control on the current page. */
async function controls(page: Page): Promise<Control[]> {
	return page.evaluate(() => {
		const TEXTUAL = ["text", "email", "password", "search", "url", "tel", "number", ""];
		const out: Control[] = [];
		for (const el of document.querySelectorAll("input, select")) {
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) continue;
			if (el instanceof HTMLInputElement && !TEXTUAL.includes(el.type)) continue;
			const style = getComputedStyle(el);
			// A control with no border is chrome (the search field, a checkbox), not a
			// form field, and is not what this contract is about.
			if (style.borderTopWidth === "0px") continue;
			out.push({
				tag: el.tagName.toLowerCase(),
				h: Math.round(rect.height),
				radius: style.borderTopLeftRadius,
				borderColor: style.borderTopColor,
				borderWidth: style.borderTopWidth,
				background: style.backgroundColor,
			});
		}
		return out;
	});
}

function distinct<T, K extends keyof T>(items: T[], key: K): unknown[] {
	return [...new Set(items.map((item) => JSON.stringify(item[key])))];
}

test.describe("form controls share one geometry", () => {
	test.use({ storageState: OWNER_STATE });

	test("a select is shaped exactly like a text input", async ({ page }) => {
		const seen: Control[] = [];
		for (const path of FORM_PAGES) {
			await page.goto(path);
			await page.waitForLoadState("networkidle").catch(() => {});
			seen.push(...(await controls(page)));
		}

		expect(seen.some((c) => c.tag === "select")).toBe(true);
		expect(seen.some((c) => c.tag === "input")).toBe(true);

		// Grouped by height so a deliberately compact control does not have to match a
		// full-size one — but within a size, a select and an input must be identical.
		for (const height of new Set(seen.map((c) => c.h))) {
			const group = seen.filter((c) => c.h === height);
			expect(distinct(group, "radius"), `radius at ${height}px`).toHaveLength(1);
			expect(distinct(group, "borderColor"), `border colour at ${height}px`).toHaveLength(1);
			expect(distinct(group, "borderWidth"), `border width at ${height}px`).toHaveLength(1);
			expect(distinct(group, "background"), `background at ${height}px`).toHaveLength(1);
		}

		// And the set of sizes in use must be small and deliberate, not incidental.
		expect(distinct(seen, "h").length, `heights in use: ${distinct(seen, "h")}`).toBeLessThanOrEqual(2);
	});

	test("rectangular buttons share one corner radius", async ({ page }) => {
		const radii = new Set<string>();
		for (const path of FORM_PAGES) {
			await page.goto(path);
			await page.waitForLoadState("networkidle").catch(() => {});
			for (const radius of await page.evaluate(() => {
				const out: string[] = [];
				for (const el of document.querySelectorAll("button")) {
					const rect = el.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) continue;
					const style = getComputedStyle(el);
					// A bare text or icon affordance paints no box, so its corner radius is
					// not something anyone can see. Only controls that render a box — a fill
					// or a border — are making a claim about their shape.
					const hasBox =
						style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.borderTopWidth !== "0px";
					if (!hasBox) continue;
					// A circle is a deliberate shape, not a rectangle with the wrong radius.
					const radiusPx = Number.parseFloat(style.borderTopLeftRadius);
					if (radiusPx >= rect.height / 2) continue;
					out.push(style.borderTopLeftRadius);
				}
				return out;
			})) {
				radii.add(radius);
			}
		}

		expect(radii.size, `radii in use: ${[...radii]}`).toBe(1);
	});
});

test.describe("page frames agree", () => {
	test.use({ storageState: OWNER_STATE });

	test("every card on settings shares one left and right edge", async ({ page }) => {
		await page.goto("/settings");
		await page.waitForLoadState("networkidle").catch(() => {});

		const bounds = await page.evaluate(() =>
			[...document.querySelectorAll("main *")]
				.filter((el) => getComputedStyle(el).borderTopWidth === "1px" && el.getBoundingClientRect().height > 100)
				.map((el) => {
					const rect = el.getBoundingClientRect();
					return `${Math.round(rect.left)}-${Math.round(rect.right)}`;
				}),
		);

		expect(bounds.length).toBeGreaterThan(1);
		expect([...new Set(bounds)], `card bounds: ${bounds}`).toHaveLength(1);
	});

	test("every admin page frames its content identically", async ({ page }) => {
		const frames: string[] = [];
		for (const path of ADMIN_PAGES) {
			await page.goto(path);
			await page.waitForLoadState("networkidle").catch(() => {});
			frames.push(
				await page.evaluate(() => {
					const main = document.querySelector("main");
					if (!main) return "no-main";
					const column = main.firstElementChild ?? main;
					const rect = column.getBoundingClientRect();
					return `${Math.round(rect.left)}-${Math.round(rect.right)}`;
				}),
			);
		}

		expect([...new Set(frames)], `frames: ${frames.map((f, i) => `${ADMIN_PAGES[i]}=${f}`)}`).toHaveLength(1);
	});
});

test.describe("the modal scrim dims in both themes", () => {
	test.use({ storageState: OWNER_STATE });

	for (const theme of ["light", "dark"] as const) {
		test(`darkens the page behind in ${theme}`, async ({ page }) => {
			await page.addInitScript((value) => {
				try {
					localStorage.setItem("theme", value);
				} catch {}
			}, theme);

			await page.goto("/mailboxes");
			await page.waitForLoadState("networkidle").catch(() => {});
			await page.getByRole("button", { name: /New mailbox/i }).first().click();

			// Composite the scrim over white and read the resulting pixel. Reading the
			// declared colour instead would not work: Chrome reports these as `oklab()`,
			// whose first channel is lightness, so a naive parse mistakes a near-white
			// scrim for a near-black one and the assertion passes on the broken case.
			// Compositing asks the question the requirement actually asks — does putting
			// this over the page make the page darker?
			const composited = await page.evaluate(() => {
				const overlay = [...document.querySelectorAll("div")].find((el) => {
					const style = getComputedStyle(el);
					return (
						style.position === "fixed" &&
						style.inset === "0px" &&
						style.backgroundColor !== "rgba(0, 0, 0, 0)"
					);
				});
				if (!overlay) return null;

				const canvas = document.createElement("canvas");
				canvas.width = 1;
				canvas.height = 1;
				const context = canvas.getContext("2d");
				if (!context) return null;
				context.fillStyle = "#ffffff";
				context.fillRect(0, 0, 1, 1);
				context.fillStyle = getComputedStyle(overlay).backgroundColor;
				context.fillRect(0, 0, 1, 1);
				const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
				return { luminance: (r + g + b) / 3, declared: getComputedStyle(overlay).backgroundColor };
			});

			expect(composited, "no fixed full-bleed overlay found").not.toBeNull();
			expect(
				composited!.luminance,
				`scrim ${composited!.declared} in ${theme} left white at ${composited!.luminance}`,
			).toBeLessThan(230);
		});
	}
});
