import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WebAppManifest = {
	name: string;
	short_name: string;
	start_url: string;
	scope: string;
	display: string;
	background_color: string;
	theme_color: string;
	icons: Array<{
		src: string;
		sizes: string;
		type: string;
		purpose?: string;
	}>;
};

const root = process.cwd();
const publicFile = (...segments: string[]) => path.join(root, "public", ...segments);

function readPublicText(file: string) {
	return readFileSync(publicFile(file), "utf8");
}

function readPngSize(file: string) {
	const buffer = readFileSync(publicFile(file));
	expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
	return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20),
	};
}

function loadManifest() {
	return JSON.parse(readPublicText("manifest.webmanifest")) as WebAppManifest;
}

function basicResponse(body: string, init?: ResponseInit) {
	const response = new Response(body, init);
	Object.defineProperty(response, "type", { value: "basic" });
	return response;
}

function createServiceWorkerHarness() {
	const origin = "https://lumimail.test";
	const listeners = new Map<string, Array<(event: any) => void>>();
	const cacheStore = new Map<string, Map<string, Response>>();
	const fetchMock = vi.fn(async (request: { url: string }) =>
		basicResponse(`network:${new URL(request.url, origin).pathname}`),
	);

	function cacheKey(input: string | { url: string }) {
		const url = typeof input === "string" ? input : input.url;
		return new URL(url, origin).href;
	}

	function cacheFor(name: string) {
		let cache = cacheStore.get(name);
		if (!cache) {
			cache = new Map();
			cacheStore.set(name, cache);
		}
		return cache;
	}

	const cachesMock = {
		open: vi.fn(async (name: string) => {
			const cache = cacheFor(name);
			return {
				addAll: vi.fn(async (urls: string[]) => {
					for (const url of urls) {
						cache.set(cacheKey(url), basicResponse(`cached:${url}`));
					}
				}),
				match: vi.fn(async (request: string | { url: string }) => cache.get(cacheKey(request))),
				put: vi.fn(async (request: string | { url: string }, response: Response) => {
					cache.set(cacheKey(request), response.clone());
				}),
			};
		}),
		keys: vi.fn(async () => [...cacheStore.keys()]),
		delete: vi.fn(async (name: string) => cacheStore.delete(name)),
		match: vi.fn(async (request: string | { url: string }, options?: { cacheName?: string }) => {
			const key = cacheKey(request);
			if (options?.cacheName) return cacheStore.get(options.cacheName)?.get(key);

			for (const cache of cacheStore.values()) {
				const response = cache.get(key);
				if (response) return response;
			}
			return undefined;
		}),
	};

	const self = {
		location: new URL(`${origin}/sw.js`),
		clients: { claim: vi.fn(async () => undefined) },
		skipWaiting: vi.fn(async () => undefined),
		addEventListener: vi.fn((type: string, listener: (event: any) => void) => {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		}),
	};

	vm.runInNewContext(readPublicText("sw.js"), {
		caches: cachesMock,
		console,
		fetch: fetchMock,
		Promise,
		Response,
		self,
		Set,
		URL,
	});

	async function dispatchLifecycle(type: "install" | "activate") {
		const pending: Promise<unknown>[] = [];
		for (const listener of listeners.get(type) ?? []) {
			listener({
				waitUntil: (promise: Promise<unknown>) => {
					pending.push(Promise.resolve(promise));
				},
			});
		}
		await Promise.all(pending);
	}

	async function dispatchFetch(request: {
		url: string;
		method?: string;
		mode?: string;
		destination?: string;
	}) {
		let response: Promise<Response> | undefined;
		for (const listener of listeners.get("fetch") ?? []) {
			listener({
				request: {
					method: "GET",
					mode: "cors",
					destination: "",
					...request,
				},
				respondWith: (promise: Promise<Response>) => {
					response = Promise.resolve(promise);
				},
			});
		}
		return response ? await response : undefined;
	}

	return {
		cacheStore,
		cachesMock,
		dispatchFetch,
		dispatchLifecycle,
		fetchMock,
		self,
	};
}

describe("PWA manifest", () => {
	it("defines installable app metadata", () => {
		expect(loadManifest()).toMatchObject({
			name: "Lumimail",
			short_name: "Lumimail",
			start_url: "/",
			scope: "/",
			display: "standalone",
			background_color: "#f6f8fc",
			theme_color: "#2563eb",
		});
	});

	it("references complete install icon sizes including maskable icons", () => {
		const manifest = loadManifest();
		const requiredIcons = [
			{ src: "/icon-48.png", sizes: "48x48", purpose: "any" },
			{ src: "/icon-96.png", sizes: "96x96", purpose: "any" },
			{ src: "/icon-192.png", sizes: "192x192", purpose: "any" },
			{ src: "/icon-512.png", sizes: "512x512", purpose: "any" },
			{ src: "/icon-maskable-192.png", sizes: "192x192", purpose: "maskable" },
			{ src: "/icon-maskable-512.png", sizes: "512x512", purpose: "maskable" },
		];

		for (const expected of requiredIcons) {
			const icon = manifest.icons.find((item) => item.src === expected.src);
			expect(icon).toBeDefined();
			expect(icon).toMatchObject({ sizes: expected.sizes, type: "image/png" });
			expect((icon?.purpose ?? "any").split(" ")).toContain(expected.purpose);

			const [width, height] = expected.sizes.split("x").map(Number);
			expect(readPngSize(expected.src.slice(1))).toEqual({ width, height });
		}
	});

	it("ships iOS touch icon and offline shell assets", () => {
		expect(existsSync(publicFile("apple-touch-icon.png"))).toBe(true);
		expect(readPngSize("apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
		expect(readPublicText("offline.html")).toContain("You are offline");
		expect(readPublicText("offline.html")).toContain("/icon-192.png");
	});
});

describe("PWA service worker assets", () => {
	it("keeps service worker and manifest headers update-friendly", () => {
		const headers = readPublicText("_headers");

		expect(headers).toMatch(/\/sw\.js[\s\S]*Service-Worker-Allowed:\s*\//);
		expect(headers).toMatch(/\/sw\.js[\s\S]*Cache-Control:\s*no-cache/);
		expect(headers).toMatch(/\/manifest\.webmanifest[\s\S]*Content-Type:\s*application\/manifest\+json/);
		expect(headers).toMatch(/\/manifest\.webmanifest[\s\S]*Cache-Control:\s*no-cache/);
	});

	it("precaches the public offline shell on install and claims clients on activate", async () => {
		const harness = createServiceWorkerHarness();

		await harness.dispatchLifecycle("install");
		harness.cacheStore.set("old-cache", new Map());
		await harness.dispatchLifecycle("activate");

		expect(harness.cacheStore.get("lumimail-pwa-v1-precache")?.has("https://lumimail.test/offline.html")).toBe(true);
		expect(harness.cacheStore.has("old-cache")).toBe(false);
		expect(harness.self.skipWaiting).toHaveBeenCalledOnce();
		expect(harness.self.clients.claim).toHaveBeenCalledOnce();
	});

	it("does not intercept non-GET, API, Next data, or cross-origin requests", async () => {
		const harness = createServiceWorkerHarness();

		await expect(
			harness.dispatchFetch({ url: "https://lumimail.test/api/messages", method: "POST" }),
		).resolves.toBeUndefined();
		await expect(harness.dispatchFetch({ url: "https://lumimail.test/api/messages" })).resolves.toBeUndefined();
		await expect(harness.dispatchFetch({ url: "https://lumimail.test/api/auth/me" })).resolves.toBeUndefined();
		await expect(harness.dispatchFetch({ url: "https://lumimail.test/_next/data/build-id/page.json" })).resolves.toBeUndefined();
		await expect(harness.dispatchFetch({ url: "https://cdn.example.test/icon.png" })).resolves.toBeUndefined();
		expect(harness.fetchMock).not.toHaveBeenCalled();
	});

	it("keeps navigations network-only and falls back to the offline shell when fetch fails", async () => {
		const harness = createServiceWorkerHarness();
		await harness.dispatchLifecycle("install");

		const online = await harness.dispatchFetch({
			url: "https://lumimail.test/inbox",
			mode: "navigate",
			destination: "document",
		});

		expect(await online?.text()).toBe("network:/inbox");
		expect(harness.cacheStore.get("lumimail-pwa-v1-runtime")?.has("https://lumimail.test/inbox")).not.toBe(true);

		harness.fetchMock.mockRejectedValueOnce(new TypeError("offline"));
		const offline = await harness.dispatchFetch({
			url: "https://lumimail.test/inbox",
			mode: "navigate",
			destination: "document",
		});

		expect(await offline?.text()).toBe("cached:/offline.html");
	});

	it("uses cache-first behavior only for allowed static assets", async () => {
		const harness = createServiceWorkerHarness();
		const iconRequest = { url: "https://lumimail.test/icon-192.png" };

		const first = await harness.dispatchFetch(iconRequest);
		expect(await first?.text()).toBe("network:/icon-192.png");

		harness.fetchMock.mockRejectedValueOnce(new TypeError("offline"));
		const second = await harness.dispatchFetch(iconRequest);
		expect(await second?.text()).toBe("network:/icon-192.png");
		expect(harness.fetchMock).toHaveBeenCalledTimes(1);
	});

	it("caches Next static assets outside local development hosts", async () => {
		const harness = createServiceWorkerHarness();

		const response = await harness.dispatchFetch({ url: "https://lumimail.test/_next/static/chunks/app.js" });

		expect(await response?.text()).toBe("network:/_next/static/chunks/app.js");
		expect(
			harness.cacheStore
				.get("lumimail-pwa-v1-runtime")
				?.has("https://lumimail.test/_next/static/chunks/app.js"),
		).toBe(true);
	});
});
