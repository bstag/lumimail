import { describe, expect, it, vi } from "vitest";
import {
	fetchGoogleSyncPage,
	fetchMicrosoftSyncPage,
	ExternalProviderRequestError,
} from "@/lib/email/external/provider-client";

const raw = btoa("From: sender@example.com\r\nTo: user@example.com\r\nSubject: Hello\r\n\r\nBody")
	.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

describe("Google external sync adapter", () => {
	it("establishes a from-now cursor without importing history", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			void input;
			void init;
			return Response.json({ emailAddress: "user@example.com", historyId: "500" });
		});
		expect(await fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "from_now" }, fetcher))
			.toEqual({ changes: [], cursor: { historyId: "500" }, hasMore: false });
		expect(String(fetcher.mock.calls[0][0])).toContain("/profile");
	});

	it("imports one bounded recent page and maps only MVP folders", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/messages?")) return Response.json({ messages: [{ id: "g1", threadId: "t1" }], nextPageToken: "next" });
			return Response.json({ id: "g1", threadId: "t1", labelIds: ["INBOX"], historyId: "501", raw });
		});
		const page = await fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "recent_30_days" }, fetcher);
		expect(page.hasMore).toBe(true);
		expect(page.cursor).toEqual({ pageToken: "next" });
		expect(page.changes[0]).toMatchObject({ remoteMessageId: "g1", remoteThreadId: "t1", remoteFolderKey: "inbox", removed: false });
		expect(new TextDecoder().decode(page.changes[0].rawMime)).toContain("Subject: Hello");
		const listUrl = new URL(String(fetcher.mock.calls[0][0]));
		expect(listUrl.searchParams.get("maxResults")).toBe("10");
		expect(listUrl.searchParams.get("q")).toContain("newer_than:30d");
	});

	it("reads incremental additions/removals and marks an expired history cursor", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/history?")) return Response.json({
				historyId: "600",
				history: [{
					messagesAdded: [{ message: { id: "g2", threadId: "t2" } }],
					messagesDeleted: [{ message: { id: "g3", threadId: "t3" } }],
				}],
			});
			return Response.json({ id: "g2", threadId: "t2", labelIds: ["SENT"], historyId: "599", raw });
		});
		const page = await fetchGoogleSyncPage({ accessToken: "token", mode: "incremental", importMode: "from_now", cursor: { historyId: "500" } }, fetcher);
		expect(page.cursor).toEqual({ historyId: "600" });
		expect(page.changes.map((change) => [change.remoteMessageId, change.remoteFolderKey, change.removed]))
			.toEqual([["g2", "sent", false], ["g3", "unknown", true]]);
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "incremental", importMode: "from_now", cursor: { historyId: "old" } },
			async () => new Response(null, { status: 404 })))
			.rejects.toMatchObject({ code: "cursor_expired", retryable: false });
	});

	it("validates Google paging, MIME identity, cursor presence, and provider failures", async () => {
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "from_now" },
			async () => Response.json({ historyId: "" })))
			.rejects.toMatchObject({ code: "invalid_provider_response" });
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "from_now" },
			async () => new Response("bad json", { status: 200 })))
			.rejects.toMatchObject({ code: "invalid_provider_response" });
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "from_now" },
			async () => new Response("down", { status: 503 })))
			.rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "from_now" },
			async () => new Response("denied", { status: 400 })))
			.rejects.toMatchObject({ code: "provider_unavailable", retryable: false });
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "incremental", importMode: "from_now" }))
			.rejects.toMatchObject({ code: "cursor_expired" });

		const completeFetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/messages?")) return Response.json({ messages: [{ id: "g1" }] });
			if (url.includes("/messages/g1")) return Response.json({ id: "wrong", labelIds: [], raw });
			return Response.json({ historyId: "700" });
		});
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "recent_30_days", cursor: { pageToken: "page2" } }, completeFetcher))
			.rejects.toMatchObject({ code: "invalid_provider_response" });
		completeFetcher.mockImplementation(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("/messages?")) return Response.json({ messages: [{ id: "g1" }] });
			if (url.includes("/messages/g1")) return Response.json({ id: "g1", labelIds: [], raw });
			return Response.json({ historyId: "700" });
		});
		const completed = await fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "recent_30_days", cursor: { pageToken: "page2" } }, completeFetcher);
		expect(completed).toMatchObject({ cursor: { historyId: "700" }, hasMore: false });
		expect(completed.changes[0].remoteFolderKey).toBe("archive");
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "recent_30_days" },
			async () => Response.json({ messages: "invalid" })))
			.rejects.toMatchObject({ code: "invalid_provider_response" });
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "recent_30_days" },
			async (input) => String(input).includes("/messages?")
				? Response.json({})
				: Response.json({ historyId: "" })))
			.rejects.toMatchObject({ code: "invalid_provider_response" });
		await expect(fetchGoogleSyncPage({
			accessToken: "token", mode: "incremental", importMode: "from_now", cursor: { historyId: "700" },
		}, async () => Response.json({ historyId: "" })))
			.rejects.toMatchObject({ code: "invalid_provider_response" });
		const emptyHistory = await fetchGoogleSyncPage({
			accessToken: "token", mode: "incremental", importMode: "from_now", cursor: { historyId: "700" },
		}, async () => Response.json({ historyId: "701", history: [{}] }));
		expect(emptyHistory.changes).toEqual([]);

		const nextHistory = await fetchGoogleSyncPage({
			accessToken: "token", mode: "incremental", importMode: "from_now", cursor: { historyId: "700", pageToken: "old-page" },
		}, async () => Response.json({ historyId: "702", nextPageToken: "next-page" }));
		expect(nextHistory).toEqual({ changes: [], cursor: { historyId: "700", pageToken: "next-page" }, hasMore: true });
	});

	it("rejects invalid or oversized Gmail raw MIME", async () => {
		const originalAtob = globalThis.atob;
		vi.stubGlobal("atob", vi.fn(() => { throw new Error("invalid"); }));
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "recent_30_days" },
			async (input) => String(input).includes("/messages?")
				? Response.json({ messages: [{ id: "g1" }], nextPageToken: "next" })
				: Response.json({ id: "g1", raw: "%%%" })))
			.rejects.toMatchObject({ code: "invalid_provider_response" });
		vi.stubGlobal("atob", vi.fn(() => "a".repeat(30 * 1024 * 1024 + 1)));
		await expect(fetchGoogleSyncPage({ accessToken: "token", mode: "initial", importMode: "recent_30_days" },
			async (input) => String(input).includes("/messages?")
				? Response.json({ messages: [{ id: "g1" }], nextPageToken: "next" })
				: Response.json({ id: "g1", raw: "eA" })))
			.rejects.toMatchObject({ code: "message_too_large" });
		vi.stubGlobal("atob", originalAtob);
	});
});

describe("Microsoft external sync adapter", () => {
	it("uses folder-scoped delta links, gets MIME, and persists the entire provider cursor URL", async () => {
		const next = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=opaque";
		const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/$value")) return new Response(new TextEncoder().encode("Subject: Graph\r\n\r\nBody"));
			void init;
			return Response.json({ value: [{ id: "m1", conversationId: "c1", "@odata.etag": "rev" }], "@odata.nextLink": next });
		});
		const page = await fetchMicrosoftSyncPage({
			accessToken: "token", folder: "inbox", importMode: "recent_30_days",
		}, fetcher, new Date("2026-08-15T00:00:00Z"));
		expect(page.cursor).toEqual({ url: next, complete: false });
		expect(page.hasMore).toBe(true);
		expect(page.changes[0]).toMatchObject({ remoteMessageId: "m1", remoteThreadId: "c1", remoteFolderKey: "inbox", remoteRevision: "rev" });
		const initial = new URL(String(fetcher.mock.calls[0][0]));
		expect(initial.searchParams.get("$filter")).toContain("2026-07-16");
		expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Prefer")).toBe("odata.maxpagesize=10");
	});

	it("handles removed entries and validates provider-issued continuation origins", async () => {
		const delta = "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=opaque";
		expect(await fetchMicrosoftSyncPage({ accessToken: "token", folder: "sent", importMode: "from_now", cursor: { url: delta, complete: true } },
			async () => Response.json({ value: [{ id: "gone", "@removed": { reason: "deleted" } }], "@odata.deltaLink": delta })))
			.toMatchObject({ changes: [{ remoteMessageId: "gone", remoteFolderKey: "sent", removed: true }], hasMore: false });
		await expect(fetchMicrosoftSyncPage({ accessToken: "token", folder: "inbox", importMode: "from_now", cursor: {
			url: "https://evil.example/steal", complete: false,
		} }, async () => Response.json({}))).rejects.toThrow("External provider cursor is invalid");
		for (const url of ["not-url", "http://graph.microsoft.com/path", "https://user@graph.microsoft.com/path", "https://graph.microsoft.com/path#hash"]) {
			await expect(fetchMicrosoftSyncPage({ accessToken: "token", folder: "inbox", importMode: "from_now", cursor: { url, complete: false } }, async () => Response.json({})))
				.rejects.toThrow("External provider cursor is invalid");
		}
	});

	it("classifies throttling, authorization loss, and malformed payloads without provider bodies", async () => {
		await expect(fetchMicrosoftSyncPage({ accessToken: "token", folder: "inbox", importMode: "from_now" },
			async () => new Response("secret", { status: 429 }))).rejects.toMatchObject({ code: "provider_throttled", retryable: true });
		await expect(fetchMicrosoftSyncPage({ accessToken: "token", folder: "inbox", importMode: "from_now" },
			async () => new Response("secret", { status: 401 }))).rejects.toMatchObject({ code: "authorization_revoked", retryable: false });
		await expect(fetchMicrosoftSyncPage({ accessToken: "token", folder: "inbox", importMode: "from_now" },
			async () => Response.json({ value: "invalid" }))).rejects.toBeInstanceOf(ExternalProviderRequestError);
		await expect(fetchMicrosoftSyncPage({ accessToken: "token", folder: "inbox", importMode: "from_now", cursor: { url: "https://graph.microsoft.com/delta", complete: true } },
			async () => new Response("gone", { status: 410 }))).rejects.toMatchObject({ code: "cursor_expired" });
	});

	it("bounds Graph MIME responses and propagates MIME authorization failures", async () => {
		const delta = { value: [{ id: "m1" }], "@odata.deltaLink": "https://graph.microsoft.com/delta" };
		await expect(fetchMicrosoftSyncPage({ accessToken: "token", folder: "archive", importMode: "from_now" },
			async (input) => String(input).endsWith("/$value")
				? new Response("denied", { status: 401 })
				: Response.json(delta)))
			.rejects.toMatchObject({ code: "authorization_revoked" });
		await expect(fetchMicrosoftSyncPage({ accessToken: "token", folder: "archive", importMode: "from_now" },
			async (input) => String(input).endsWith("/$value")
				? new Response("x", { headers: { "content-length": String(31 * 1024 * 1024) } })
				: Response.json(delta)))
			.rejects.toMatchObject({ code: "message_too_large" });
		const oversized = { ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(30 * 1024 * 1024 + 1) } as Response;
		await expect(fetchMicrosoftSyncPage({ accessToken: "token", folder: "archive", importMode: "from_now" },
			async (input) => String(input).endsWith("/$value") ? oversized : Response.json(delta)))
			.rejects.toMatchObject({ code: "message_too_large" });
	});
});
