import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { invalidateMessageQueries } from "@/lib/query-keys";
import { fetchDraft } from "./utils";
import type { ComposeDraft } from "./types";
import { withoutInlineImages } from "./compose-form-utils";

const AUTOSAVE_DELAY_MS = 900;

export type DraftSaveState = "idle" | "saving" | "saved" | "failed";

/**
 * Owns the compose form's draft lifecycle: loading an existing draft on mount
 * and debounced autosave of the current field values. The form supplies the
 * field values each render and receives loaded-draft contents through
 * `onDraftLoaded` (the hook does not own the field state).
 */
export function useComposeDraft({
	draftIdToLoad,
	fromAddr,
	mailboxId,
	paused,
	fields,
	onDraftLoaded,
	onLoadError,
}: {
	draftIdToLoad?: string | null;
	fromAddr: string;
	mailboxId: string | undefined;
	paused: boolean;
	fields: {
		to: string;
		subject: string;
		text: string;
		html: string;
		replyToMessageId: string | null;
	};
	onDraftLoaded: (draft: ComposeDraft) => void;
	onLoadError: (message: string) => void;
}) {
	const queryClient = useQueryClient();
	const [draftId, setDraftId] = useState<string | null>(null);
	const [loadingDraft, setLoadingDraft] = useState(Boolean(draftIdToLoad));
	const [saveState, setSaveState] = useState<DraftSaveState>("idle");
	const [loadedDraftMailboxId, setLoadedDraftMailboxId] = useState<string | null>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const persistedId = useRef<string | null>(null);
	const savedPayload = useRef<string | null>(null);
	const revision = useRef(0);
	const saves = useRef(Promise.resolve(true));
	const { to, subject, text, html, replyToMessageId } = fields;

	useEffect(() => {
		if (!draftIdToLoad) return;

		let cancelled = false;
		setLoadingDraft(true);
		fetchDraft(draftIdToLoad)
			.then((draft) => {
				if (cancelled) return;
				persistedId.current = draft.id;
				setDraftId(draft.id);
				setLoadedDraftMailboxId(draft.mailboxId);
				onDraftLoaded(draft);
			})
			.catch((err) => {
				if (cancelled) return;
				onLoadError(err instanceof Error ? err.message : "");
			})
			.finally(() => {
				if (!cancelled) setLoadingDraft(false);
			});

		return () => {
			cancelled = true;
		};
		// onDraftLoaded/onLoadError are stable per form instance; the load must
		// run once per draft id, not when the callbacks re-create.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draftIdToLoad]);

	const payload = useMemo(() => {
		if (!fromAddr || loadingDraft || paused || !(draftId || to.trim() || subject.trim() || text.trim() || html.trim())) return null;
		return JSON.stringify({ mailboxId, from: fromAddr, to, subject, text, html: withoutInlineImages(html),
			...(replyToMessageId ? { replyToMessageId } : {}) });
	}, [draftId, fromAddr, html, loadingDraft, mailboxId, paused, replyToMessageId, subject, text, to]);

	const enqueueSave = useCallback((body: string, version: number) => {
		const save = saves.current.then(async () => {
			if (version !== revision.current) return false;
			try {
				if (savedPayload.current !== body) {
					const id = persistedId.current;
					const response = await authFetch(id ? `/api/drafts/${id}` : "/api/drafts", {
						method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body,
					});
					const { draft } = await parseApiResponse<{ draft: { id: string } }>(response);
					persistedId.current = draft.id;
					savedPayload.current = body;
					setDraftId(draft.id);
					void invalidateMessageQueries(queryClient);
				}
				const current = version === revision.current;
				if (current) setSaveState("saved");
				return current;
			} catch {
				if (version === revision.current) setSaveState("failed");
				return false;
			}
		});
		saves.current = save;
		return save;
	}, [queryClient]);

	useEffect(() => {
		if (!payload) return;
		const version = ++revision.current;
		setSaveState("saving");
		saveTimer.current = setTimeout(() => {
			void enqueueSave(payload, version);
		}, AUTOSAVE_DELAY_MS);
		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [enqueueSave, payload]);

	async function saveNow() {
		if (!payload) return true;
		if (saveTimer.current) clearTimeout(saveTimer.current);
		setSaveState("saving");
		return enqueueSave(payload, ++revision.current);
	}

	async function discardAfterSend() {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		revision.current++;
		await saves.current;
		const id = persistedId.current;
		persistedId.current = null;
		savedPayload.current = null;
		setDraftId(null);
		setSaveState("idle");
		if (!id) return;
		await authFetch(`/api/drafts/${id}`, { method: "DELETE" }).catch(() => undefined);
		void invalidateMessageQueries(queryClient);
	}

	return { draftId, loadingDraft, loadedDraftMailboxId, saveState, saveNow, discardAfterSend };
}
