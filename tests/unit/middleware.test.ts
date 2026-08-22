import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import middleware from "@/middleware";

function request(path: string, init?: RequestInit) {
	return new NextRequest(`https://mail.example${path}`, init as never);
}

describe("middleware origin checks", () => {
	it("allows v1 API requests and non-mutating application requests", () => {
		expect(middleware(request("/api/v1/send", { method: "POST" })).status).toBe(200);
		expect(middleware(request("/api/messages", { method: "GET" })).status).toBe(200);
	});

	it("rejects a cross-origin API mutation without a same-host referrer", async () => {
		const response = middleware(request("/api/messages", {
			method: "POST",
			headers: { origin: "https://evil.example", host: "mail.example" },
		}));
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({ error: "Invalid origin" });
	});

	it("allows same-origin mutations and trusted referrers", () => {
		expect(middleware(request("/api/messages", {
			method: "POST",
			headers: { origin: "https://mail.example", host: "mail.example" },
		})).status).toBe(200);
		expect(middleware(request("/api/messages", {
			method: "PUT",
			headers: {
				origin: "https://evil.example",
				referer: "https://mail.example/inbox",
				host: "mail.example",
			},
		})).status).toBe(200);
	});
});
