import type { Page } from "@playwright/test";

/**
 * Mocks the requests the mail shell makes on every dashboard route.
 *
 * `authFetch` treats a 401 as a lost session: it clears the stored token and
 * navigates to `/login`. So any shell request a test forgets to mock does not
 * merely return nothing — it tears the page down mid-test. The failure then
 * surfaces wherever the redirect happens to land, as a detached element, an
 * aborted navigation, or an assertion against `/login`, none of which point at
 * the missing mock.
 *
 * `/api/labels` was doing exactly that 287 times across a single suite run. It is
 * requested by the folder pages regardless of what a test is about, so it belongs
 * here rather than in each spec that happens to trip over it.
 */
export async function mockShellNoise(page: Page): Promise<void> {
	await page.route("**/api/labels", (route) => route.fulfill({ json: { labels: [] } }));
}

/** Flat `/api/messages/counts` payload used by most specs. */
export function flatCounts(overrides: Record<string, number> = {}) {
	return { inbox: 0, starred: 0, drafts: 0, sent: 0, spam: 0, trash: 0, ...overrides };
}

/** Nested `/api/messages/counts` payload (`{ counts: { folders, mailboxes } }`). */
export function folderCounts(
	overrides: Record<string, { total: number; unread: number }> = {},
) {
	return {
		counts: {
			folders: {
				inbox: { total: 0, unread: 0 },
				sent: { total: 0, unread: 0 },
				drafts: { total: 0, unread: 0 },
				trash: { total: 0, unread: 0 },
				spam: { total: 0, unread: 0 },
				starred: { total: 0, unread: 0 },
				...overrides,
			},
			mailboxes: [],
		},
	};
}

export type MockAuthShellOptions = {
	/**
	 * Value seeded into `localStorage["lumimail-session-token"]` before any
	 * page script runs. Pass `null` to skip seeding entirely (specs that rely
	 * on the mocked `/api/auth/me` alone).
	 */
	sessionToken?: string | null;
	/** The `user` object `/api/auth/me` returns. */
	user?: Record<string, unknown>;
	/** The `hasMailboxes` flag `/api/auth/me` returns. */
	hasMailboxes?: boolean;
	/**
	 * Mailbox list `/api/mailboxes` returns. Pass `null` to leave the route
	 * unregistered (specs that install their own per-test `/api/mailboxes`
	 * handler).
	 */
	mailboxes?: Array<Record<string, unknown>> | null;
	/**
	 * Payload for `/api/messages/counts`. Omit to leave the route
	 * unregistered (admin-only pages never request it). Use `flatCounts()` or
	 * `folderCounts()` to build the two shapes the app understands.
	 */
	counts?: Record<string, unknown>;
};

/**
 * Mocks the authenticated mail shell: session token, shell noise, and the
 * `/api/auth/me` + `/api/mailboxes` (+ optionally `/api/messages/counts`)
 * requests every dashboard route makes. Register spec-specific routes AFTER
 * calling this — Playwright matches the most recently registered handler
 * first, so later registrations override these defaults (e.g. a custom
 * `/api/labels` payload on top of `mockShellNoise`'s empty list).
 *
 * `/api/mailboxes` and `/api/messages/counts` are fulfilled with the F40
 * `{ success: true, data }` envelope (T-33). `/api/auth/me` stays flat — it
 * is part of the documented envelope exception set.
 */
export async function mockAuthShell(
	page: Page,
	options: MockAuthShellOptions = {},
): Promise<void> {
	const {
		sessionToken = "e2e-session",
		user = { id: "user_1", role: "owner" },
		hasMailboxes = true,
		mailboxes = [],
		counts,
	} = options;

	if (sessionToken !== null) {
		await page.addInitScript((token) => {
			localStorage.setItem("lumimail-session-token", token);
		}, sessionToken);
	}
	await mockShellNoise(page);
	await page.route("**/api/auth/me", (route) =>
		route.fulfill({ json: { user, hasMailboxes } }),
	);
	if (mailboxes !== null) {
		await page.route("**/api/mailboxes", (route) =>
			route.fulfill({ json: { success: true, data: { mailboxes } } }),
		);
	}
	if (counts !== undefined) {
		await page.route("**/api/messages/counts**", (route) =>
			route.fulfill({ json: { success: true, data: counts } }),
		);
	}
}
