import type { NavLink } from "./components-nav";

/**
 * Which destinations the mobile bottom bar carries.
 *
 * The bar holds far fewer entries than the nav, so the choice has to be made rather
 * than assumed. It is made from the already capability-filtered nav links, not from a
 * hardcoded list: a viewer has no Compose and no Drafts, and a bar with gaps where
 * those would be is worse than a bar that simply carries the next things down.
 */

/** Preferred order. Anything absent from the nav is skipped, not left blank. */
export const MOBILE_TAB_PRIORITY = [
	"/inbox",
	"/sent",
	"/drafts",
	"/starred",
	"/spam",
	"/trash",
] as const;

/** How many destinations fit beside the More button on a narrow phone. */
export const MOBILE_TAB_LIMIT = 4;

/**
 * Picks the bar's destinations from the nav links the user actually has.
 *
 * Order follows `MOBILE_TAB_PRIORITY` rather than the nav's own order so the bar stays
 * stable: a user who gains send capability sees Drafts appear in a predictable slot
 * instead of the whole bar reshuffling.
 */
export function selectMobileTabs(links: NavLink[], limit: number = MOBILE_TAB_LIMIT): NavLink[] {
	const byHref = new Map(links.filter((link) => link.href).map((link) => [link.href, link]));

	const selected: NavLink[] = [];
	for (const href of MOBILE_TAB_PRIORITY) {
		if (selected.length >= limit) break;
		const link = byHref.get(href);
		if (link) selected.push(link);
	}
	return selected;
}
