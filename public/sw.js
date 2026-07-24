/* global caches, fetch, Response, self */

const VERSION = "lumimail-pwa-v2";
const PRECACHE_CACHE = `${VERSION}-precache`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
	OFFLINE_URL,
	"/manifest.webmanifest",
	"/favicon.ico",
	"/icon-48.png",
	"/icon-96.png",
	"/icon-192.png",
	"/icon-512.png",
	"/icon-maskable-192.png",
	"/icon-maskable-512.png",
	"/apple-touch-icon.png",
];

const PUBLIC_ASSET_PATHS = new Set(PRECACHE_URLS);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const NETWORK_ONLY_PREFIXES = [
	"/api/auth/",
	"/api/",
	"/_next/data/",
	"/login",
	"/register",
	"/onboarding",
	"/inbox",
	"/sent",
	"/drafts",
	"/trash",
	"/spam",
	"/starred",
	"/labels",
	"/contacts",
	"/settings",
	"/filters",
	"/compose",
	"/admin",
	"/mailboxes",
	"/aliases",
	"/domains",
	"/routing",
	"/webhooks",
	"/members",
	"/api-keys",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(PRECACHE_CACHE)
			.then((cache) => cache.addAll(PRECACHE_URLS))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((key) => key !== PRECACHE_CACHE && key !== RUNTIME_CACHE).map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;

	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (isNavigationRequest(request)) {
		event.respondWith(networkOnlyWithOfflineFallback(request));
		return;
	}

	if (isNetworkOnlyRequest(request, url)) return;

	if (isCacheableStaticAsset(url)) {
		event.respondWith(cacheFirst(request));
	}
});

function isNavigationRequest(request) {
	return request.mode === "navigate" || request.destination === "document";
}

function isNetworkOnlyRequest(request, url) {
	if (request.method !== "GET") return true;
	return NETWORK_ONLY_PREFIXES.some((prefix) => pathMatchesPrefix(url.pathname, prefix));
}

function pathMatchesPrefix(pathname, prefix) {
	if (prefix.endsWith("/")) return pathname.startsWith(prefix);
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isCacheableStaticAsset(url) {
	// Only cache our own precached public assets (icons, manifest, offline page).
	// Next.js build output under /_next/static/ is content-hashed and served with
	// immutable HTTP cache headers, so the browser cache handles it correctly. The
	// SW must NOT cache-first those chunks: a constant runtime-cache name meant old
	// chunks were never purged, so a stale bundle could be served indefinitely after
	// a deploy. Let /_next/static/ fall through to the network / HTTP cache.
	return PUBLIC_ASSET_PATHS.has(url.pathname);
}

async function networkOnlyWithOfflineFallback(request) {
	try {
		return await fetch(request);
	} catch {
		const fallback = await caches.match(OFFLINE_URL, { cacheName: PRECACHE_CACHE });
		if (fallback) return fallback;
		return new Response("<!doctype html><title>You are offline</title><h1>You are offline</h1>", {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}
}

async function cacheFirst(request) {
	const cache = await caches.open(RUNTIME_CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok && response.type === "basic") {
		await cache.put(request, response.clone());
	}
	return response;
}
