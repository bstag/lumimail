/**
 * Sidebar collapse state and geometry.
 *
 * Kept out of the layout components so the persistence rules are testable without
 * rendering a shell, and so both sections read the same key rather than each
 * inventing one.
 */

export const SIDEBAR_STORAGE_KEY = "lumimail-sidebar-collapsed";

/** Width of the rail when collapsed, and of the full sidebar when not. */
export const SIDEBAR_WIDTH = { collapsed: 64, expanded: 256 } as const;

/**
 * Reads the persisted preference.
 *
 * Anything other than an explicit `"1"` means expanded, including a missing key, a
 * value written by an older build, and a storage that throws — Safari's private mode
 * raises on `getItem`, and a nav that refuses to render because of it would be a far
 * worse failure than one that opens expanded.
 */
export function readSidebarCollapsed(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
	if (!storage) return false;
	try {
		return storage.getItem(SIDEBAR_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

/** Persists the preference, treating an unavailable storage as a no-op. */
export function writeSidebarCollapsed(
	storage: Pick<Storage, "setItem"> | null | undefined,
	collapsed: boolean,
): void {
	if (!storage) return;
	try {
		storage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
	} catch {
		// A preference that cannot be saved is not worth failing a navigation over.
	}
}

/**
 * The shell's grid template for a given state.
 *
 * Returned as a value rather than toggled between two Tailwind classes because
 * `grid-cols-[...]` arbitrary values are generated at build time and a conditional
 * pair is easy to get subtly wrong; one function keeps the two widths in one place.
 */
export function sidebarGridColumns(collapsed: boolean): string {
	return `${collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded}px 1fr`;
}
