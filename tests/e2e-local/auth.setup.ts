import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Signs in once per role and saves the session for the rest of the suite.
 *
 * Logging in per test tripped the login rate limiter — five attempts per minute
 * per IP — which made a different test fail on every run. That limiter is correct
 * behaviour catching a bad test pattern, so the tests changed rather than the
 * policy. This also makes the suite faster: two sign-ins instead of eleven.
 */

import { E2E_PASSWORD, MEMBER_STATE, OWNER_STATE } from "./auth-paths";

async function signInAndSave(page: import("@playwright/test").Page, email: string, file: string) {
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

setup("authenticate as owner", async ({ page }) => {
	await signInAndSave(page, "e2e-owner@e2e.test", OWNER_STATE);
});

setup("authenticate as member", async ({ page }) => {
	await signInAndSave(page, "e2e-member@e2e.test", MEMBER_STATE);
});
