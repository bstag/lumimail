"use client";

import { useEffect, useState } from "react";

/**
 * Tracks a media query in JavaScript rather than in CSS.
 *
 * Used where a breakpoint must decide whether a component *exists*, not merely
 * whether it is shown. `md:hidden` leaves the markup in the document, so a hidden
 * mobile bar would still put a second "Drafts" link and a second "Compose" button in
 * the accessibility tree at desktop — a real duplication, and one that also makes
 * every strict `getByRole` locator in the suites ambiguous.
 *
 * Starting `false` and resolving in an effect is safe here: `AuthGuard` renders
 * nothing until the session check resolves, so the shell's first paint already
 * happens after mount.
 */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(false);

	useEffect(() => {
		const list = window.matchMedia(query);
		setMatches(list.matches);

		function onChange(event: MediaQueryListEvent) {
			setMatches(event.matches);
		}

		list.addEventListener("change", onChange);
		return () => list.removeEventListener("change", onChange);
	}, [query]);

	return matches;
}

/** Below Tailwind's `md`, which is where the sidebar stops being a sidebar. */
export const MOBILE_QUERY = "(max-width: 767px)";
