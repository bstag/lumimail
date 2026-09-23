import { describe, expect, it, vi } from "vitest";
import { getExternalProviderAdapter } from "@/lib/email/external/provider-adapter";

describe("external provider adapters", () => {
	it("keeps Google MIME retrieval lazy behind the adapter contract", async () => {
		const raw = btoa("Subject: Google\r\n\r\nBody")
			.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/messages?")) return Response.json({ messages: [{ id: "g1" }], nextPageToken: "next" });
			if (url.includes("format=metadata")) return Response.json({ id: "g1", labelIds: ["INBOX"] });
			return Response.json({ id: "g1", raw });
		});
		const page = await getExternalProviderAdapter("google").fetchSyncPage({
			accessToken: "token", mode: "initial", importMode: "recent_30_days",
			readCursor: vi.fn(async () => undefined), fetcher,
		});

		expect(page.cursors).toEqual([{ key: "gmail", type: "gmail_history", value: { pageToken: "next" } }]);
		expect(page.changes[0].rawMime).toBeUndefined();
		expect(page.changes[0].loadRawMime).toBeTypeOf("function");
		await page.changes[0].loadRawMime!();
		expect(fetcher.mock.calls.filter(([input]) => String(input).includes("format=raw"))).toHaveLength(1);
	});

	it("preserves all Microsoft folder changes while deferring each MIME request", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith("/$value")) return new Response("Subject: Microsoft\r\n\r\nBody");
			return Response.json({
				value: [{ id: new URL(url).pathname.split("/").at(-3) ?? "message" }],
				"@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta",
			});
		});
		const page = await getExternalProviderAdapter("microsoft").fetchSyncPage({
			accessToken: "token", mode: "initial", importMode: "from_now",
			readCursor: vi.fn(async () => undefined), fetcher,
		});

		expect(page.changes).toHaveLength(3);
		expect(page.cursors.map((cursor) => cursor.key)).toEqual(["inbox", "sent", "archive"]);
		expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith("/$value"))).toHaveLength(0);
		for (const change of page.changes) await change.loadRawMime!();
		expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith("/$value"))).toHaveLength(3);
	});
});
