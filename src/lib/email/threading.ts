export const MAX_REFERENCE_ENTRIES = 100;
export const MAX_THREAD_HEADER_BYTES = 2048;
const MAX_MESSAGE_ID_BYTES = 998;
const MESSAGE_ID_PATTERN = /<[^<>\r\n]+>/g;

function utf8Length(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function normalizeRfcMessageId(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!/^<[^<>\r\n]+>$/.test(trimmed)) return null;
	if (utf8Length(trimmed) > MAX_MESSAGE_ID_BYTES) return null;
	return trimmed;
}

export function normalizeReferences(value: string | null | undefined): string[] {
	if (!value) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const match of value.match(MESSAGE_ID_PATTERN) ?? []) {
		const normalized = normalizeRfcMessageId(match);
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

function boundReferences(references: string[]): string[] {
	const bounded = references.length > MAX_REFERENCE_ENTRIES
		? [references[0], ...references.slice(-(MAX_REFERENCE_ENTRIES - 1))]
		: [...references];
	while (
		bounded.length > 1
		&& utf8Length(bounded.join(" ")) > MAX_THREAD_HEADER_BYTES
	) {
		bounded.splice(1, 1);
	}
	return bounded;
}

export type ReplyThreadingSource = {
	rfcMessageId: string | null;
	providerMessageId: string | null;
	referencesHeader: string | null;
};

export type ReplyThreading = {
	inReplyTo: string | null;
	referencesHeader: string | null;
	headers?: {
		"In-Reply-To": string;
		References: string;
	};
};

export function buildReplyThreading(source: ReplyThreadingSource): ReplyThreading {
	const parent = normalizeRfcMessageId(source.rfcMessageId)
		?? normalizeRfcMessageId(source.providerMessageId);
	if (!parent) {
		return { inReplyTo: null, referencesHeader: null, headers: undefined };
	}
	const references = normalizeReferences(source.referencesHeader);
	if (!references.includes(parent)) references.push(parent);
	const bounded = boundReferences(references);
	const referencesHeader = bounded.join(" ");
	return {
		inReplyTo: parent,
		referencesHeader,
		headers: {
			"In-Reply-To": parent,
			References: referencesHeader,
		},
	};
}

export async function deriveMailboxThreadId(
	mailboxId: string,
	rootMessageId: string,
): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`${mailboxId}\0${rootMessageId}`),
	);
	const hex = Array.from(new Uint8Array(digest).slice(0, 16))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `thr_${hex}`;
}

export type InboundThreading = {
	threadId: string;
	rfcMessageId: string | null;
	inReplyTo: string | null;
	referencesHeader: string | null;
};

export async function resolveInboundThreading(input: {
	mailboxId: string;
	messageId: string | null;
	inReplyTo: string | null;
	references: string | null;
	fallbackThreadId: string | (() => string);
	findAncestor: (candidates: string[]) => Promise<{ threadId: string | null } | null>;
}): Promise<InboundThreading> {
	const rfcMessageId = normalizeRfcMessageId(input.messageId);
	const inReplyTo = normalizeRfcMessageId(input.inReplyTo)
		?? normalizeReferences(input.inReplyTo)[0]
		?? null;
	const references = boundReferences(normalizeReferences(input.references));
	const referencesHeader = references.length ? references.join(" ") : null;
	const candidates = [
		...(inReplyTo ? [inReplyTo] : []),
		...references.slice().reverse(),
	].filter((candidate, index, all) => all.indexOf(candidate) === index);
	if (candidates.length) {
		const ancestor = await input.findAncestor(candidates);
		if (ancestor?.threadId) {
			return { threadId: ancestor.threadId, rfcMessageId, inReplyTo, referencesHeader };
		}
	}
	const root = references[0] ?? inReplyTo ?? rfcMessageId;
	const threadId = root
		? await deriveMailboxThreadId(input.mailboxId, root)
		: typeof input.fallbackThreadId === "function"
			? input.fallbackThreadId()
			: input.fallbackThreadId;
	return { threadId, rfcMessageId, inReplyTo, referencesHeader };
}
