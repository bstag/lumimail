import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
	turbopack: {
		root: import.meta.dirname,
	},
	async headers() {
		return [
			{
				source: "/sw.js",
				headers: [
					{ key: "Cache-Control", value: "no-cache" },
					{ key: "Content-Type", value: "application/javascript; charset=utf-8" },
					{ key: "Service-Worker-Allowed", value: "/" },
				],
			},
			{
				source: "/manifest.webmanifest",
				headers: [
					{ key: "Cache-Control", value: "no-cache" },
					{ key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
				],
			},
			{
				source: "/offline.html",
				headers: [{ key: "Cache-Control", value: "no-cache" }],
			},
		];
	},
};

export default withNextIntl(nextConfig);

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
