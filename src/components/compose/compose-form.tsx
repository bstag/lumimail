"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Editor } from "@tiptap/react";
import { Minimize2, Paperclip, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import {
	canMailboxSend,
	findSendCapableMailbox,
} from "@/components/mailbox-provider-utils";
import { useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { invalidateMessageQueries } from "@/lib/query-keys";
import { formatEmailAddress } from "@/lib/email/address";
import { cn } from "@/lib/utils";
import { submitMessage } from "./utils";
import { buildForwardQuote, plainTextToHtml } from "./compose-form-utils";
import { useComposeAttachments } from "./use-compose-attachments";
import { useComposeDraft } from "./use-compose-draft";
import { AttachmentChips } from "./attachment-chips";
import { ComposeEditor } from "./compose-editor";
import { ComposeEditorToolbar } from "./compose-editor-toolbar";

type Toast = { type: "success" | "error"; message: string } | null;

type MessageWithBodyResponse = {
	message?: { fromAddr?: string; toAddr?: string; subject?: string | null };
	body?: { textBody?: string | null; htmlBody?: string | null };
};

export function ComposeForm({
	mode = "page",
	draftIdToLoad,
	onClose,
}: {
	mode?: "page" | "popup";
	draftIdToLoad?: string | null;
	onClose?: () => void;
}) {
	const t = useTranslations("compose");
	const queryClient = useQueryClient();
	const searchParams = useSearchParams();
	const { selectedMailbox, setSelectedMailbox, mailboxes } = useSelectedMailbox();
	const [to, setTo] = useState("");
	const [subject, setSubject] = useState("");
	const [text, setText] = useState("");
	const [html, setHtml] = useState("");
	const [editor, setEditor] = useState<Editor | null>(null);
	const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
	const [toast, setToast] = useState<Toast>(null);
	const [loading, setLoading] = useState(false);

	const fromAddr = useMemo(
		() =>
			selectedMailbox && canMailboxSend(selectedMailbox)
				? formatEmailAddress(
						`${selectedMailbox.localPart}@${selectedMailbox.hostname}`,
						selectedMailbox.displayName ?? selectedMailbox.localPart,
					)
				: "",
		[selectedMailbox],
	);

	const {
		attachedFiles,
		fileInputRef,
		imageInputRef,
		handleFileInputChange,
		handleInlineImageChange,
		removeAttachment,
		removeByContentId,
		clearAttachments,
	} = useComposeAttachments(editor, (message) => setToast({ type: "error", message }));

	const draft = useComposeDraft({
		draftIdToLoad,
		fromAddr,
		mailboxId: selectedMailbox?.id,
		fields: { to, subject, text, html, replyToMessageId },
		onDraftLoaded: (loaded) => {
			setTo(loaded.toAddr);
			setSubject(loaded.subject ?? "");
			setText(loaded.textBody ?? "");
			setHtml(loaded.htmlBody ?? plainTextToHtml(loaded.textBody ?? ""));
			setReplyToMessageId(loaded.replySourceMessageId);
		},
		onLoadError: (message) =>
			setToast({ type: "error", message: message || t("draftLoadFailed") }),
	});
	const { loadingDraft } = draft;

	useEffect(() => {
		if (canMailboxSend(selectedMailbox)) return;
		const sendMailbox = findSendCapableMailbox(mailboxes);
		if (sendMailbox) setSelectedMailbox(sendMailbox);
	}, [mailboxes, selectedMailbox, setSelectedMailbox]);

	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(() => setToast(null), 3200);
		return () => clearTimeout(timer);
	}, [toast]);

	useEffect(() => {
		if (draftIdToLoad) return;
		const toParam = searchParams.get("to");
		const subjectParam = searchParams.get("subject");
		const forwardOf = searchParams.get("forwardOf");
		const inReplyTo = searchParams.get("inReplyTo");
		if (toParam) setTo(toParam);
		if (subjectParam) setSubject(subjectParam);
		if (inReplyTo && !forwardOf) {
			setReplyToMessageId(inReplyTo);
			return;
		}
		setReplyToMessageId(null);
		if (!forwardOf) return;

		let cancelled = false;
		authFetch(`/api/messages/${forwardOf}`)
			.then((res) => (res.ok ? parseApiResponse<MessageWithBodyResponse>(res) : null))
			.then((payload) => {
				if (cancelled || !payload?.body) return;
				const quoted = buildForwardQuote(payload.message, payload.body.textBody ?? "");
				setText((current) => {
					const next = current + quoted;
					setHtml(plainTextToHtml(next));
					return next;
				});
			})
			.catch(() => {
				/* prefill is best-effort */
			});

		return () => {
			cancelled = true;
		};
	}, [searchParams, draftIdToLoad]);

	useEffect(() => {
		if (!draft.loadedDraftMailboxId) return;
		if (selectedMailbox?.id === draft.loadedDraftMailboxId) return;

		const draftMailbox = mailboxes.find((mailbox) => mailbox.id === draft.loadedDraftMailboxId);
		if (draftMailbox) setSelectedMailbox(draftMailbox);
	}, [draft.loadedDraftMailboxId, mailboxes, selectedMailbox?.id, setSelectedMailbox]);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!text.trim()) {
			setToast({ type: "error", message: t("bodyRequired") });
			return;
		}
		setLoading(true);
		try {
			await submitMessage({
				from: fromAddr,
				to,
				subject,
				text,
				html,
				mailboxId: selectedMailbox?.id,
				...(replyToMessageId ? { replyToMessageId } : {}),
			},
			attachedFiles
				.filter((attachment) => attachment.disposition === "attachment")
				.map((attachment) => attachment.file),
			attachedFiles
				.filter((attachment) => attachment.disposition === "inline")
				.map((attachment) => ({
					file: attachment.file,
					contentId: attachment.contentId as string,
				})),
			);
			setLoading(false);
		} catch (error) {
			setLoading(false);
			setToast({ type: "error", message: error instanceof Error ? error.message : t("sendFailed") });
			return;
		}

		draft.discardAfterSend();
		setTo("");
		setSubject("");
		setText("");
		setHtml("");
		setReplyToMessageId(null);
		clearAttachments();
		setToast({ type: "success", message: t("sendSuccess") });
		void invalidateMessageQueries(queryClient);
	}

	const frameClass =
		mode === "popup"
			? "fixed bottom-4 right-4 z-40 flex h-[min(520px,calc(100vh-88px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-2xl"
			: "flex min-h-[320px] w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm";

	const isSending = loading;

	return (
		<>
			{toast && (
				<div
					className={cn(
						"fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg",
						toast.type === "success" ? "bg-success text-white" : "bg-danger text-white",
					)}
				>
					{toast.message}
				</div>
			)}
			<form onSubmit={onSubmit} className={frameClass}>
				<div className="flex h-9 items-center justify-between border-b border-border bg-surface-subtle px-4 text-sm font-medium text-ink">
					<span>{loadingDraft ? t("loadingDraft") : draft.draftId ? t("draftSaved") : t("newMessage")}</span>
					{mode === "popup" && (
						<div className="flex items-center gap-3 text-ink-muted">
							<Minimize2 className="h-4 w-4" />
							<button type="button" onClick={onClose}>
								<X className="h-4 w-4" />
							</button>
						</div>
					)}
				</div>
				<div className="border-b border-border px-4 py-1">
					<Label htmlFor={`${mode}-from`} className="sr-only">{t("from")}</Label>
					<Input
						id={`${mode}-from`}
						value={fromAddr}
						placeholder={t("selectMailboxFirst")}
						readOnly
						required
						className="h-8 border-0 px-0 py-1 shadow-none focus-visible:ring-0"
					/>
				</div>
				<div className="border-b border-border px-4 py-1">
					<Label htmlFor={`${mode}-to`} className="sr-only">{t("to")}</Label>
					<Input
						id={`${mode}-to`}
						value={to}
						onChange={(event) => setTo(event.target.value)}
						type="text"
						placeholder={t("recipientsPlaceholder")}
						required
						disabled={loadingDraft}
						className="h-8 border-0 px-0 py-1 shadow-none focus-visible:ring-0"
					/>
				</div>
				<div className="border-b border-border px-4 py-1">
					<Label htmlFor={`${mode}-subject`} className="sr-only">{t("subject")}</Label>
					<Input
						id={`${mode}-subject`}
						value={subject}
						onChange={(event) => setSubject(event.target.value)}
						placeholder={t("subject")}
						required
						disabled={loadingDraft}
						className="h-8 border-0 px-0 py-1 shadow-none focus-visible:ring-0"
					/>
				</div>
				<div className="flex min-h-0 flex-1 flex-col">
					<Label className="sr-only">{t("body")}</Label>
					<ComposeEditorToolbar
						editor={editor}
						onInsertImage={() => imageInputRef.current?.click()}
						onRemoveInlineImage={removeByContentId}
					/>
					<div className="min-h-0 flex-1 overflow-y-auto">
						<ComposeEditor
							content={html}
							label={t("body")}
							disabled={loadingDraft}
							onEditorReady={setEditor}
							onChange={(content) => {
								setHtml(content.html);
								setText(content.text);
							}}
						/>
					</div>
				</div>
				<AttachmentChips
					attachments={attachedFiles}
					onRemove={removeAttachment}
				/>
				<div className="flex items-center gap-3 border-t border-border px-4 py-3">
					<input
						ref={fileInputRef}
						type="file"
						multiple
						className="sr-only"
						onChange={handleFileInputChange}
						aria-label="Attach files"
					/>
					<input
						ref={imageInputRef}
						type="file"
						accept="image/jpeg,image/png,image/gif,image/webp"
						className="sr-only"
						onChange={handleInlineImageChange}
						aria-label="Insert inline image"
					/>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						disabled={isSending || loadingDraft}
						className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle hover:text-ink-muted disabled:opacity-40"
						title="Attach files"
					>
						<Paperclip className="h-4 w-4" />
					</button>
					<span className="flex-1" />
					<p className="text-xs text-ink-muted">
						{draft.draftId
								? t("savedToDrafts")
								: t("autosaveDraft")}
					</p>
					<Button type="submit" disabled={isSending || loadingDraft || !fromAddr} className="rounded-full px-5">
						<Send className="h-4 w-4" />
						{isSending ? t("sending") : t("send")}
					</Button>
				</div>
			</form>
		</>
	);
}
