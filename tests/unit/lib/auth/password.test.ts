import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
	it("produces a bcrypt hash that is not the plaintext", () => {
		const hash = hashPassword("s3cret-pw");
		expect(hash).not.toBe("s3cret-pw");
		expect(hash.startsWith("$2")).toBe(true);
	});

	it("verifies a correct password", () => {
		const hash = hashPassword("correct horse");
		expect(verifyPassword("correct horse", hash)).toBe(true);
	});

	it("rejects an incorrect password", () => {
		const hash = hashPassword("correct horse");
		expect(verifyPassword("wrong", hash)).toBe(false);
	});
});
