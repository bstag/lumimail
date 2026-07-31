import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth/client";
import { invalidateMessageQueries } from "@/lib/query-keys";
import { fetchDraft } from "./utils";
import type { ComposeDraft } from "./types";
import { withoutInlineImages } from "./compose-form-utils";

const AUTOSAVE_DELAY_MS = 900;

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
	fields,
	onDraftLoaded,
	onLoadError,
}: {
	draftIdToLoad?: string | null;
	fromAddr: string;
	mailboxId: string | undefined;
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
	const [loadingDraft, setLoadingDraft] = useState(false);
	const [loadedDraftMailboxId, setLoadedDraftMailboxId] = useState<string | null>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const { to, subject, text, html, replyToMessageId } = fields;

	useEffect(() => {
		if (!draftIdToLoad) return;

		let cancelled = false;
		setLoadingDraft(true);
		fetchDraft(draftIdToLoad)
			.then((draft) => {
				if (cancelled) return;
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

	useEffect(() => {
		const hasContent = to.trim() || subject.trim() || text.trim();
		if (!fromAddr || !hasContent || loadingDraft) return;
		if (saveTimer.current) clearTimeout(saveTimer.current);

		saveTimer.current = setTimeout(async () => {
			const payload = {
				mailboxId,
				from: fromAddr,
				to,
				subject,
				text,
				html: withoutInlineImages(html),
				...(replyToMessageId ? { replyToMessageId } : {}),
			};
			const res = await authFetch(draftId ? `/api/drafts/${draftId}` : "/api/drafts", {
				method: draftId ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const data = (await res.json()) as { draft?: { id: string } };
			if (res.ok && data.draft?.id) {
				setDraftId(data.draft.id);
				void invalidateMessageQueries(queryClient);
			}
		}, AUTOSAVE_DELAY_MS);

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [draftId, fromAddr, html, loadingDraft, mailboxId, queryClient, replyToMessageId, subject, text, to]);

	/** Deletes the sent draft (fire-and-forget) and resets local draft state. */
	function discardAfterSend() {
		if (draftId) {
			void authFetch(`/api/drafts/${draftId}`, { method: "DELETE" }).then((response) => {
				if (response.ok) void invalidateMessageQueries(queryClient);
			});
		}
		setDraftId(null);
	}

	return { draftId, loadingDraft, loadedDraftMailboxId, discardAfterSend };
}
