import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../../../../helpers/db";

const m = vi.hoisted(() => ({ db: null as unknown, getCurrentUser: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({}) }));
vi.mock("@/db", () => ({ getDb: () => m.db }));
vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: m.getCurrentUser }));

import { GET, MAX_REMOTE_IMAGE_BYTES } from "@/app/api/messages/[messageId]/remote-image/route";

const IMAGE = "https://cdn.example.com/logo.png?a=1&b=2";
const STORED = `<p>Hi</p><img data-remote-src="https://cdn.example.com/logo.png?a=1&amp;b=2" alt="Logo">`;

let mock: DbMock;
const fetchMock = vi.fn();

beforeEach(() => {
	mock = createDbMock();
	m.db = mock.db;
	m.getCurrentUser.mockReset().mockResolvedValue({ id: "u1", organizationId: "o1" });
	fetchMock.mockReset().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
		headers: { "content-type": "image/png", "content-length": "3", "set-cookie": "track=1" },
	}));
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function get(url: string | null = IMAGE) {
	const query = url === null ? "" : `?u=${encodeURIComponent(url)}`;
	return GET(new Request(`https://x.test/api/messages/m1/remote-image${query}`), {
		params: Promise.resolve({ messageId: "m1" }),
	});
}

describe("GET /api/messages/[messageId]/remote-image", () => {
	it("requires a signed-in user", async () => {
		m.getCurrentUser.mockResolvedValue(null);
		expect((await get()).status).toBe(401);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("denies a message the user cannot read (cross-tenant denial)", async () => {
		mock.queueSelect([]);
		expect((await get()).status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("refuses URLs that do not appear in the message, so it is not an open proxy", async () => {
		mock.queueSelect([{ htmlBody: STORED }]);
		expect((await get("https://evil.example/other.png")).status).toBe(404);
		mock.queueSelect([{ htmlBody: STORED }]);
		expect((await get(null)).status).toBe(404);
		mock.queueSelect([{ htmlBody: `<img data-remote-src="file:///etc/passwd">` }]);
		expect((await get("file:///etc/passwd")).status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("streams an image without forwarding the reader's identity or the sender's cookies", async () => {
		mock.queueSelect([{ htmlBody: STORED }]);
		const res = await get();

		expect(res.status).toBe(200);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("content-security-policy")).toContain("sandbox");
		expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
		expect(res.headers.get("set-cookie")).toBeNull();
		const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(target).toBe(IMAGE);
		expect(init.credentials).toBe("omit");
		expect(new Headers(init.headers).get("cookie")).toBeNull();
		expect(init.referrerPolicy).toBe("no-referrer");
	});

	it("rejects non-raster content such as SVG or HTML", async () => {
		for (const type of ["image/svg+xml", "text/html", ""]) {
			mock.queueSelect([{ htmlBody: STORED }]);
			fetchMock.mockResolvedValueOnce(new Response("<svg/>", { headers: { "content-type": type } }));
			expect((await get()).status, type).toBe(415);
		}
	});

	it("rejects a response with no content type", async () => {
		mock.queueSelect([{ htmlBody: STORED }]);
		fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1])));
		expect((await get()).status).toBe(415);
	});

	it("rejects images over the size cap by declared or actual length", async () => {
		mock.queueSelect([{ htmlBody: STORED }]);
		fetchMock.mockResolvedValueOnce(new Response("x", {
			headers: { "content-type": "image/jpeg", "content-length": String(MAX_REMOTE_IMAGE_BYTES + 1) },
		}));
		expect((await get()).status).toBe(413);

		mock.queueSelect([{ htmlBody: STORED }]);
		fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(MAX_REMOTE_IMAGE_BYTES + 1), {
			headers: { "content-type": "image/jpeg" },
		}));
		expect((await get()).status).toBe(413);
	});

	it("reports an upstream failure as a bad gateway", async () => {
		mock.queueSelect([{ htmlBody: STORED }]);
		fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
		expect((await get()).status).toBe(502);

		mock.queueSelect([{ htmlBody: STORED }]);
		fetchMock.mockRejectedValueOnce(new Error("timeout"));
		expect((await get()).status).toBe(502);
	});
});
