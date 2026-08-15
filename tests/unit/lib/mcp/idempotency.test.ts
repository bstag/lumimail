import { describe, expect, it } from "vitest";
import {
	IdempotencyConflictError,
	assertIdempotencyKey,
	hashMcpSendRequest,
	resolveExistingIdempotency,
} from "@/lib/mcp/idempotency";

describe("MCP outbound idempotency contract", () => {
	it("accepts only bounded opaque client keys", () => {
		expect(assertIdempotencyKey("request_0123456789")).toBe("request_0123456789");
		for (const key of ["short", "contains whitespace", "x".repeat(129), "line\nbreak________"] ) {
			expect(() => assertIdempotencyKey(key)).toThrow("idempotency key");
		}
	});

	it("hashes normalized semantic input deterministically", async () => {
		const first = await hashMcpSendRequest({
			from: "Sender@Example.com ",
			to: " Recipient@Example.com",
			subject: "Hello",
			text: "Body",
		});
		const equivalent = await hashMcpSendRequest({
			text: "Body",
			subject: "Hello",
			to: "recipient@example.com",
			from: "sender@example.com",
		});
		const changed = await hashMcpSendRequest({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Changed",
			text: "Body",
		});

		expect(first).toBe(equivalent);
		expect(changed).not.toBe(first);
		expect(first).toMatch(/^[a-f0-9]{64}$/);
		await expect(hashMcpSendRequest({
			from: "sender@example.com", to: "recipient@example.com", subject: "HTML", html: "<p>Body</p>",
		})).resolves.toMatch(/^[a-f0-9]{64}$/);
	});

	it("returns the original acceptance only for the same request hash", () => {
		const existing = { requestHash: "hash_1", messageId: "msg_1", status: "queued" as const };
		expect(resolveExistingIdempotency(existing, "hash_1")).toEqual({
			messageId: "msg_1",
			status: "queued",
			replayed: true,
		});
		expect(() => resolveExistingIdempotency(existing, "hash_2")).toThrow(IdempotencyConflictError);
		expect(resolveExistingIdempotency(null, "hash_1")).toBeNull();
	});
});
