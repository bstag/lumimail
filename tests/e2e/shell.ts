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
