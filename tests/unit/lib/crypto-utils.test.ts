import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/crypto-utils";

describe("sha256Hex", () => {
	it("matches the published SHA-256 test vector for 'abc'", async () => {
		expect(await sha256Hex("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("hashes the empty string to the well-known digest", async () => {
		expect(await sha256Hex("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("returns 64 lowercase hex characters and encodes input as UTF-8", async () => {
		const digest = await sha256Hex("sess_tok::ü");
		expect(digest).toMatch(/^[a-f0-9]{64}$/);
		// Distinct inputs produce distinct digests (sanity, not a crypto proof).
		expect(digest).not.toBe(await sha256Hex("sess_tok::u"));
	});
});
