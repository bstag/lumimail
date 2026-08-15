const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_KEYS = 5;
const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;

export type ExternalSecretKeyring = {
	active: string;
	keys: Record<string, string>;
};

export type SealedExternalSecret = {
	keyId: string;
	iv: string;
	ciphertext: string;
};

function configurationError(): Error {
	return new Error("External token encryption is not configured correctly");
}

function decodeBase64Url(value: string): Uint8Array {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
	const decoded = atob(padded);
	return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(value.byteLength);
	copy.set(value);
	return copy.buffer;
}

export function parseExternalSecretKeyring(value: string | undefined): ExternalSecretKeyring {
	try {
		if (!value) throw configurationError();
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw configurationError();
		const candidate = parsed as { active?: unknown; keys?: unknown };
		if (typeof candidate.active !== "string" || !KEY_ID_PATTERN.test(candidate.active)) throw configurationError();
		if (!candidate.keys || typeof candidate.keys !== "object" || Array.isArray(candidate.keys)) throw configurationError();
		const entries = Object.entries(candidate.keys);
		if (entries.length < 1 || entries.length > MAX_KEYS) throw configurationError();
		for (const [keyId, encoded] of entries) {
			if (!KEY_ID_PATTERN.test(keyId) || typeof encoded !== "string" ||
				decodeBase64Url(encoded).length !== AES_KEY_BYTES) throw configurationError();
		}
		if (!Object.hasOwn(candidate.keys, candidate.active)) throw configurationError();
		return { active: candidate.active, keys: candidate.keys as Record<string, string> };
	} catch {
		throw configurationError();
	}
}

async function importEncryptionKey(encoded: string, usage: KeyUsage): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		toArrayBuffer(decodeBase64Url(encoded)),
		{ name: "AES-GCM" },
		false,
		[usage],
	);
}

function additionalData(context: string): Uint8Array {
	if (context.length < 1 || context.length > 512) throw new Error("External secret context is invalid");
	return new TextEncoder().encode(`lumimail:external-secret:v1:${context}`);
}

export async function encryptExternalSecret(
	plaintext: string,
	context: string,
	keyring: ExternalSecretKeyring,
	providedIv?: Uint8Array,
): Promise<SealedExternalSecret> {
	if (plaintext.length < 1 || plaintext.length > 65_536) throw new Error("External secret plaintext is invalid");
	const encodedKey = keyring.keys[keyring.active];
	if (!encodedKey) throw new Error("External secret key version is unavailable");
	const iv = providedIv ?? crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
	if (iv.length !== AES_GCM_IV_BYTES) throw new Error("External secret envelope is invalid");
	const key = await importEncryptionKey(encodedKey, "encrypt");
	const ciphertext = await crypto.subtle.encrypt(
		{
			name: "AES-GCM",
			iv: toArrayBuffer(iv),
			additionalData: toArrayBuffer(additionalData(context)),
			tagLength: 128,
		},
		key,
		toArrayBuffer(new TextEncoder().encode(plaintext)),
	);
	return {
		keyId: keyring.active,
		iv: encodeBase64Url(iv),
		ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
	};
}

export async function decryptExternalSecret(
	sealed: SealedExternalSecret,
	context: string,
	keyring: ExternalSecretKeyring,
): Promise<string> {
	const encodedKey = keyring.keys[sealed.keyId];
	if (!encodedKey) throw new Error("External secret key version is unavailable");
	let iv: Uint8Array;
	let ciphertext: Uint8Array;
	try {
		iv = decodeBase64Url(sealed.iv);
		ciphertext = decodeBase64Url(sealed.ciphertext);
		if (iv.length !== AES_GCM_IV_BYTES || ciphertext.length < 17) throw new Error("invalid envelope");
	} catch {
		throw new Error("External secret envelope is invalid");
	}
	try {
		const key = await importEncryptionKey(encodedKey, "decrypt");
		const plaintext = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: toArrayBuffer(iv),
				additionalData: toArrayBuffer(additionalData(context)),
				tagLength: 128,
			},
			key,
			toArrayBuffer(ciphertext),
		);
		return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
	} catch {
		throw new Error("External secret could not be decrypted");
	}
}
