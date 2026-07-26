import { test as setup, expect, type Browser, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Establishes one session per role for the rest of the suite.
 *
 * Logging in per test tripped the login rate limiter — five attempts per minute
 * per IP — which made a different test fail on every run. That limiter is correct
 * behaviour catching a bad test pattern, so the tests changed rather than the
 * policy.
 *
 * Signing in once per role is still not enough on its own: three roles means two
 * runs inside a minute reach six attempts and the third role is refused, so the
 * whole suite fails on nothing but being run twice. A saved session is valid for
 * thirty days, so this reuses one that still resolves and signs in only when there
 * is nothing to reuse. Repeat runs then cost no login attempts at all.
 */

import { E2E_PASSWORD, MEMBER_STATE, OWNER_STATE, VIEWER_STATE } from "./auth-paths";

/** Returns true when the saved state still resolves to an authenticated session. */
async function reuseSavedSession(browser: Browser, file: string): Promise<boolean> {
	if (!existsSync(file)) return false;

	const context = await browser.newContext({ storageState: file });
	try {
		const page = await context.newPage();
		await page.goto("/login");
		const status = await page.evaluate(async () => (await fetch("/api/auth/me")).status);
		return status === 200;
	} catch {
		// A saved state that cannot even be loaded is worth nothing; sign in instead.
		return false;
	} finally {
		await context.close();
	}
}

async function signInAndSave(page: Page, email: string, file: string) {
	mkdirSync(dirname(file), { recursive: true });

	await page.goto("/login");
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill(E2E_PASSWORD);
	await page.getByRole("button", { name: "Sign in" }).click();

	// The mail shell is the signal the session took effect. Waiting on a DOM state
	// rather than a URL avoids racing the client-side redirect.
	//
	// The budget matches the project's 120s test timeout rather than undercutting it.
	// A cold dev server compiles `/login`, the login route, and the mail shell during
	// this first sign-in, which has exceeded 60s on a cold start; the same request
	// takes under a second once warm. The cost is the dev server's, not the app's.
	await page.waitForSelector('[placeholder="Search mail"]', { timeout: 110_000 });

	// Guard against saving an unauthenticated state, which would make every
	// downstream failure look like an authorization bug.
	const me = await page.evaluate(async () => (await fetch("/api/auth/me")).status);
	expect(me).toBe(200);

	await page.context().storageState({ path: file });
}

async function establishSession(browser: Browser, page: Page, email: string, file: string) {
	if (await reuseSavedSession(browser, file)) return;
	await signInAndSave(page, email, file);
}

setup("authenticate as owner", async ({ browser, page }) => {
	await establishSession(browser, page, "e2e-owner@e2e.test", OWNER_STATE);
});

setup("authenticate as member", async ({ browser, page }) => {
	await establishSession(browser, page, "e2e-member@e2e.test", MEMBER_STATE);
});

setup("authenticate as viewer", async ({ browser, page }) => {
	await establishSession(browser, page, "e2e-viewer@e2e.test", VIEWER_STATE);
});
