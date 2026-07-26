import type { Page } from "@playwright/test";

/**
 * Navigates to a path, tolerating the abort a client-side redirect causes.
 *
 * Next's App Router cancels an in-flight document navigation when it redirects
 * during load, so `page.goto` rejects with `ERR_ABORTED` even though the app is
 * behaving correctly. Two cases share that symptom:
 *
 *  - The app deliberately redirects (a viewer sent away from `/compose`). The
 *    abort is expected; the destination is what the test asserts.
 *  - A preceding interaction is still settling and races the navigation. Here the
 *    page is reachable, and a second attempt gets it.
 *
 * Retrying once serves both: a real redirect still ends at the redirect target,
 * and a raced navigation completes. Callers assert the destination either way, so
 * this never hides a wrong outcome — only a navigation that could not complete.
 */
export async function gotoAllowingRedirect(page: Page, path: string): Promise<void> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			await page.goto(path);
			return;
		} catch (error) {
			if (!String(error).includes("ERR_ABORTED")) throw error;
		}
	}

	// Both attempts aborted, which means the app redirected each time. Let the
	// destination finish rendering so the caller's assertion sees a settled page.
	await page.waitForLoadState("domcontentloaded").catch(() => {});
}
