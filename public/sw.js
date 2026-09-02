/* global caches, fetch, Response, self */

const VERSION = "lumimail-pwa-v5";
const PRECACHE_CACHE = `${VERSION}-precache`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
	OFFLINE_URL,
	"/manifest.webmanifest",
	"/picket-favicon-v1.ico",
	"/picket-icon-v1-48.png",
	"/picket-icon-v1-96.png",
	"/picket-icon-v1-192.png",
	"/picket-icon-v1-512.png",
	"/picket-icon-maskable-v1-192.png",
	"/picket-icon-maskable-v1-512.png",
	"/picket-apple-touch-icon-v1.png",
];

const PUBLIC_ASSET_PATHS = new Set(PRECACHE_URLS);
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

const PUSH_DELIVERY_ID = /^pudl_[A-Za-z0-9_-]{21}$/;

self.addEventListener("push", (event) => {
	if (!event.data) return;

	let payload;
	try {
		payload = event.data.json();
	} catch {
		return;
	}

	if (!isPushPayload(payload)) return;
	const { notificationId } = payload;
	event.waitUntil(self.registration.showNotification("New mail", {
		body: "Open Picket to view it.",
		icon: "/picket-icon-v1-192.png",
		badge: "/picket-icon-v1-96.png",
		tag: notificationId,
		data: { path: `/notifications/${notificationId}` },
	}));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const path = event.notification.data?.path;
	if (typeof path !== "string" || !isNotificationPath(path)) return;

	const target = new URL(path, self.location.origin).href;
	event.waitUntil(focusOrOpenNotification(target));
});

self.addEventListener("pushsubscriptionchange", (event) => {
	// Never silently create a replacement subscription: that would restore a
	// device's delivery capability without a fresh user gesture or preferences.
	event.waitUntil(self.registration.showNotification("Notifications paused", {
		body: "Open Picket to enable notifications again.",
		icon: "/picket-icon-v1-192.png",
		badge: "/picket-icon-v1-96.png",
		tag: "lumimail-push-subscription-change",
		data: { path: "/settings/notifications" },
	}));
});

function isPushPayload(payload) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
	const keys = Object.keys(payload);
	return keys.length === 1
		&& keys[0] === "notificationId"
		&& typeof payload.notificationId === "string"
		&& PUSH_DELIVERY_ID.test(payload.notificationId);
}

function isNotificationPath(path) {
	if (path === "/settings/notifications") return true;
	const prefix = "/notifications/";
	return path.startsWith(prefix) && PUSH_DELIVERY_ID.test(path.slice(prefix.length));
}

async function focusOrOpenNotification(target) {
	const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
	const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
	if (existing) {
		if (typeof existing.navigate === "function") await existing.navigate(target);
		await existing.focus();
		return;
	}
	await self.clients.openWindow(target);
}

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
