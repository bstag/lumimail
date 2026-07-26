import type { Browser, Page } from "@playwright/test";

/**
 * Request helpers shared by the local suites.
 *
 * Requests are issued from inside the page rather than through Playwright's
 * request context, so the session cookie the app actually sets is the thing being
 * exercised. A test that forged its own header would prove nothing about the real
 * authentication path.
 */

export interface ApiRequest {
	method?: string;
	body?: unknown;
}

export interface ApiResponse {
	status: number;
	body: string;
}

export async function api(page: Page, path: string, request: ApiRequest = {}): Promise<ApiResponse> {
	return page.evaluate(
		async ({ p, r }) => {
			const response = await fetch(p, {
				method: r.method ?? "GET",
				...(r.body === undefined
					? {}
					: { headers: { "Content-Type": "application/json" }, body: JSON.stringify(r.body) }),
			});
			return { status: response.status, body: await response.text() };
		},
		{ p: path, r: request as { method?: string; body?: unknown } },
	);
}

/**
 * Reads a path in a throwaway context authenticated as another role.
 *
 * Needed where an endpoint refuses to disclose whether it acted — a second party
 * who can see the row is the only way to tell a denial from a silent success.
 */
export async function asRole(
	browser: Browser,
	storageState: string,
	path: string,
): Promise<ApiResponse> {
	const context = await browser.newContext({ storageState });
	try {
		const page = await context.newPage();
		await page.goto("/inbox");
		return await api(page, path);
	} finally {
		await context.close();
	}
}
