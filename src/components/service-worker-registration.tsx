"use client";

import { useEffect } from "react";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function canRegisterServiceWorker() {
	return (
		"serviceWorker" in navigator &&
		(window.location.protocol === "https:" || LOCAL_HOSTS.has(window.location.hostname))
	);
}

export function ServiceWorkerRegistration() {
	useEffect(() => {
		if (!canRegisterServiceWorker()) return;

		let cancelled = false;
		const register = () => {
			if (cancelled) return;
			void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
		};

		if (document.readyState === "complete") {
			register();
		} else {
			window.addEventListener("load", register, { once: true });
		}

		return () => {
			cancelled = true;
			window.removeEventListener("load", register);
		};
	}, []);

	return null;
}
