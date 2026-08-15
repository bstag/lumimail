import { describe, expect, it } from "vitest";
import {
	decryptExternalSecret,
	encryptExternalSecret,
	parseExternalSecretKeyring,
} from "@/lib/email/external/secret-vault";

const key = (byte: number) => Buffer.alloc(32, byte).toString("base64url");

describe("external account secret vault", () => {
	it("parses a bounded versioned AES-256 keyring", () => {
		expect(parseExternalSecretKeyring(JSON.stringify({
			active: "v2",
			keys: { v1: key(1), v2: key(2) },
		}))).toEqual({
			active: "v2",
			keys: { v1: key(1), v2: key(2) },
		});

		for (const invalid of [
			undefined,
			"not json",
			"null",
			"[]",
			JSON.stringify({ active: 1, keys: { v1: key(1) } }),
			JSON.stringify({ active: "v1", keys: null }),
			JSON.stringify({ active: "v1", keys: "not-object" }),
			JSON.stringify({ active: "v1", keys: [] }),
			JSON.stringify({ active: "v2", keys: { v1: key(1) } }),
			JSON.stringify({ active: "v1", keys: {} }),
			JSON.stringify({ active: "v1", keys: { v1: "short" } }),
			JSON.stringify({ active: "v1", keys: { v1: "***" } }),
			JSON.stringify({ active: "v1", keys: { v1: 123 } }),
			JSON.stringify({ active: "v1", keys: { v1: key(1), "bad.id": key(2) } }),
			JSON.stringify({ active: "../v1", keys: { "../v1": key(1) } }),
			JSON.stringify({ active: "v1", keys: Object.fromEntries(
				Array.from({ length: 6 }, (_, index) => [`v${index}`, key(index)]),
			) }),
		]) {
			expect(() => parseExternalSecretKeyring(invalid)).toThrow("External token encryption is not configured correctly");
		}
	});

	it("encrypts without retaining plaintext and decrypts with bound context", async () => {
		const keyring = parseExternalSecretKeyring(JSON.stringify({
			active: "v1",
			keys: { v1: key(7) },
		}));
		const sealed = await encryptExternalSecret("refresh-token-secret", "account:ext_1", keyring,
			new Uint8Array(12).fill(9));

		expect(sealed).toEqual({
			keyId: "v1",
			iv: "CQkJCQkJCQkJCQkJ",
			ciphertext: expect.any(String),
		});
		expect(JSON.stringify(sealed)).not.toContain("refresh-token-secret");
		expect(await decryptExternalSecret(sealed, "account:ext_1", keyring)).toBe("refresh-token-secret");
	});

	it("fails closed for tampering, wrong context, missing versions, and invalid envelopes", async () => {
		const keyring = parseExternalSecretKeyring(JSON.stringify({
			active: "v2",
			keys: { v1: key(1), v2: key(2) },
		}));
		const sealed = await encryptExternalSecret("token", "account:ext_1", keyring);

		await expect(decryptExternalSecret(sealed, "account:ext_2", keyring)).rejects.toThrow("External secret could not be decrypted");
		const tampered = `${sealed.ciphertext[0] === "A" ? "B" : "A"}${sealed.ciphertext.slice(1)}`;
		await expect(decryptExternalSecret({ ...sealed, ciphertext: tampered }, "account:ext_1", keyring))
			.rejects.toThrow("External secret could not be decrypted");
		await expect(decryptExternalSecret({ ...sealed, keyId: "v3" }, "account:ext_1", keyring))
			.rejects.toThrow("External secret key version is unavailable");
		await expect(decryptExternalSecret({ ...sealed, iv: "bad" }, "account:ext_1", keyring))
			.rejects.toThrow("External secret envelope is invalid");
	});

	it("keeps older ciphertext decryptable after active-key rotation", async () => {
		const first = parseExternalSecretKeyring(JSON.stringify({ active: "v1", keys: { v1: key(1) } }));
		const sealed = await encryptExternalSecret("old-token", "account:ext_1", first);
		const rotated = parseExternalSecretKeyring(JSON.stringify({
			active: "v2",
			keys: { v1: key(1), v2: key(2) },
		}));

		expect(await decryptExternalSecret(sealed, "account:ext_1", rotated)).toBe("old-token");
		expect((await encryptExternalSecret("new-token", "account:ext_1", rotated)).keyId).toBe("v2");
	});

	it("bounds plaintext, context, active keys, IVs, and ciphertext envelopes", async () => {
		const keyring = parseExternalSecretKeyring(JSON.stringify({ active: "v1", keys: { v1: key(1) } }));
		await expect(encryptExternalSecret("", "context", keyring)).rejects.toThrow("External secret plaintext is invalid");
		await expect(encryptExternalSecret("x".repeat(65_537), "context", keyring)).rejects.toThrow("External secret plaintext is invalid");
		await expect(encryptExternalSecret("token", "", keyring)).rejects.toThrow("External secret context is invalid");
		await expect(encryptExternalSecret("token", "x".repeat(513), keyring)).rejects.toThrow("External secret context is invalid");
		await expect(encryptExternalSecret("token", "context", { active: "v2", keys: { v1: key(1) } }))
			.rejects.toThrow("External secret key version is unavailable");
		await expect(encryptExternalSecret("token", "context", keyring, new Uint8Array(11)))
			.rejects.toThrow("External secret envelope is invalid");
		const sealed = await encryptExternalSecret("token", "context", keyring);
		await expect(decryptExternalSecret({ ...sealed, ciphertext: "AQ" }, "context", keyring))
			.rejects.toThrow("External secret envelope is invalid");
		await expect(decryptExternalSecret(sealed, "", keyring))
			.rejects.toThrow("External secret could not be decrypted");
	});
});
