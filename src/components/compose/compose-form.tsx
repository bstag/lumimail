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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { apiJson } from "@/lib/api/client-response";
import { invalidateMessageQueries } from "@/lib/query-keys";
import { formatEmailAddress } from "@/lib/email/address";
import { cn } from "@/lib/utils";
import { submitMessage } from "./utils";
import { buildForwardQuote, plainTextToHtml } from "./compose-form-utils";
import { useComposeAttachments, type AttachedFile } from "./use-compose-attachments";
import { useComposeDraft } from "./use-compose-draft";
import { AttachmentChips } from "./attachment-chips";
import { ComposeEditor } from "./compose-editor";
import { ComposeEditorToolbar } from "./compose-editor-toolbar";

type Toast = { type: "success" | "error"; message: string } | null;

type MessageWithBodyResponse = {
	message?: { fromAddr?: string; toAddr?: string; subject?: string | null };
	body?: { textBody?: string | null; htmlBody?: string | null };
};

type ExternalSender = {
	id: string;
	mailboxId: string;
	provider: "google" | "microsoft";
	externalAddress: string;
	status: string;
};

function activeExternalSenders(accounts: ExternalSender[] | undefined, mailboxId: string | undefined) {
	return (accounts ?? []).filter((account) => account.status === "active" && account.mailboxId === mailboxId);
}

function nativeSenderAddress(mailbox: ReturnType<typeof useSelectedMailbox>["selectedMailbox"]) {
	if (!mailbox || !canMailboxSend(mailbox)) return "";
	return formatEmailAddress(`${mailbox.localPart}@${mailbox.hostname}`, mailbox.displayName ?? mailbox.localPart);
}

function ComposeToast({ toast }: { toast: Toast }) {
	if (!toast) return null;
	return <div className={cn("fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg", toast.type === "success" ? "bg-success text-white" : "bg-danger text-white")}>{toast.message}</div>;
}

function ComposeHeader({ mode, loadingDraft, draftId, onClose }: { mode: "page" | "popup"; loadingDraft: boolean; draftId: string | null | undefined; onClose?: () => void }) {
	const t = useTranslations("compose");
	const title = loadingDraft ? t("loadingDraft") : draftId ? t("draftSaved") : t("newMessage");
	return <div className="flex h-9 items-center justify-between border-b border-border bg-surface-subtle px-4 text-sm font-medium text-ink"><span>{title}</span>{mode === "popup" && <div className="flex items-center gap-3 text-ink-muted"><Minimize2 className="h-4 w-4" /><button type="button" onClick={onClose}><X className="h-4 w-4" /></button></div>}</div>;
}

function ComposeFooter({ draftId, sending, loadingDraft, fromAddr, fileInputRef, imageInputRef, onFileChange, onImageChange }: {
	draftId: string | null | undefined; sending: boolean; loadingDraft: boolean; fromAddr: string;
	fileInputRef: React.RefObject<HTMLInputElement | null>; imageInputRef: React.RefObject<HTMLInputElement | null>;
	onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void; onImageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
	const t = useTranslations("compose");
	return <div className="flex items-center gap-3 border-t border-border px-4 py-3">
		<input ref={fileInputRef} type="file" multiple className="sr-only" onChange={onFileChange} aria-label="Attach files" />
		<input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="sr-only" onChange={onImageChange} aria-label="Insert inline image" />
		<button type="button" onClick={() => fileInputRef.current?.click()} disabled={sending || loadingDraft} className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle hover:text-ink-muted disabled:opacity-40" title="Attach files"><Paperclip className="h-4 w-4" /></button>
		<span className="flex-1" /><p className="text-xs text-ink-muted">{draftId ? t("savedToDrafts") : t("autosaveDraft")}</p>
		<Button type="submit" disabled={sending || loadingDraft || !fromAddr} className="rounded-full px-5"><Send className="h-4 w-4" />{sending ? t("sending") : t("send")}</Button>
	</div>;
}

function submissionParts(attachedFiles: AttachedFile[]) {
	return {
		attachments: attachedFiles.filter((attachment) => attachment.disposition === "attachment").map((attachment) => attachment.file),
		inlineAttachments: attachedFiles.filter((attachment) => attachment.disposition === "inline").map((attachment) => ({ file: attachment.file, contentId: attachment.contentId as string })),
	};
}

function submissionPayload({ from, to, subject, text, html, mailboxId, externalSender, replyToMessageId }: {
	from: string; to: string; subject: string; text: string; html: string; mailboxId?: string;
	externalSender?: ExternalSender; replyToMessageId: string | null;
}) {
	return {
		from, to, subject, text, html, mailboxId,
		...(externalSender ? { externalAccountId: externalSender.id } : {}),
		...(replyToMessageId ? { replyToMessageId } : {}),
	};
}

function selectedSenderAddress(externalSender: ExternalSender | undefined, nativeAddress: string) {
	return externalSender?.externalAddress ?? nativeAddress;
}

function draftSender(externalSender: ExternalSender | undefined, fromAddr: string, mailboxId: string | undefined) {
	return { fromAddr: externalSender ? "" : fromAddr, mailboxId };
}

function composeFrameClass(mode: "page" | "popup") {
	return mode === "popup"
		? "fixed bottom-4 right-4 z-40 flex h-[min(520px,calc(100vh-88px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-2xl"
		: "flex min-h-[320px] w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm";
}

function ComposeSenderSelect({ mode, selected, nativeAddress, senders, onChange }: {
	mode: "page" | "popup"; selected?: ExternalSender; nativeAddress: string; senders: ExternalSender[]; onChange: (id: string) => void;
}) {
	const t = useTranslations("compose");
	return <div className="border-b border-border px-4 py-1"><Label htmlFor={`${mode}-from`} className="sr-only">{t("from")}</Label><select id={`${mode}-from`} value={selected?.id ?? "native"} onChange={(event) => onChange(event.target.value === "native" ? "" : event.target.value)} required className="h-8 w-full border-0 bg-transparent px-0 py-1 text-sm outline-none"><option value="native">{nativeAddress || t("selectMailboxFirst")}</option>{senders.map((account) => <option key={account.id} value={account.id}>{account.externalAddress} ({account.provider})</option>)}</select></div>;
}

function draftValue(value: string | null | undefined, fallback = "") {
	return value ?? fallback;
}

function mailboxId(mailbox: ReturnType<typeof useSelectedMailbox>["selectedMailbox"]) {
	return mailbox?.id;
}

function ComposeFormContent({
	mode,
	draftIdToLoad,
	onClose,
}: {
	mode: "page" | "popup";
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
	const [externalAccountId, setExternalAccountId] = useState("");
	const externalAccounts = useQuery({
		queryKey: ["external-accounts"],
		queryFn: () => apiJson.get<{ accounts: ExternalSender[] }>("/api/external-accounts"),
	});
	const selectedMailboxId = mailboxId(selectedMailbox);
	const externalSenders = activeExternalSenders(externalAccounts.data?.accounts, selectedMailboxId);
	const selectedExternalSender = externalSenders.find((account) => account.id === externalAccountId);

	const nativeFromAddr = useMemo(() => nativeSenderAddress(selectedMailbox), [selectedMailbox]);
	const fromAddr = selectedSenderAddress(selectedExternalSender, nativeFromAddr);

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

	const draftIdentity = draftSender(selectedExternalSender, fromAddr, selectedMailboxId);
	const draft = useComposeDraft({
		draftIdToLoad,
		fromAddr: draftIdentity.fromAddr,
		mailboxId: draftIdentity.mailboxId,
		fields: { to, subject, text, html, replyToMessageId },
		onDraftLoaded: (loaded) => {
			setTo(loaded.toAddr);
			setSubject(draftValue(loaded.subject));
			setText(draftValue(loaded.textBody));
			setHtml(draftValue(loaded.htmlBody, plainTextToHtml(draftValue(loaded.textBody))));
			setReplyToMessageId(loaded.replySourceMessageId);
		},
		onLoadError: (message) =>
			setToast({ type: "error", message: message || t("draftLoadFailed") }),
	});
	const { loadingDraft } = draft;

	// A reply carries the mailbox that received the message (F76). Honoured before
	// the send-capability fallback below so it wins, and only when that mailbox
	// can actually send — otherwise the composer would seed an identity the
	// server will refuse.
	const fromMailboxIdParam = searchParams.get("fromMailboxId");
	useEffect(() => {
		if (!fromMailboxIdParam) return;
		if (selectedMailboxId === fromMailboxIdParam) return;
		const requested = mailboxes.find((mailbox) => mailbox.id === fromMailboxIdParam);
		if (requested && canMailboxSend(requested)) setSelectedMailbox(requested);
	}, [fromMailboxIdParam, mailboxes, selectedMailboxId, setSelectedMailbox]);

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
		if (selectedMailboxId === draft.loadedDraftMailboxId) return;

		const draftMailbox = mailboxes.find((mailbox) => mailbox.id === draft.loadedDraftMailboxId);
		if (draftMailbox) setSelectedMailbox(draftMailbox);
	}, [draft.loadedDraftMailboxId, mailboxes, selectedMailboxId, setSelectedMailbox]);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!text.trim()) {
			setToast({ type: "error", message: t("bodyRequired") });
			return;
		}
		setLoading(true);
		try {
			const parts = submissionParts(attachedFiles);
			await submitMessage(submissionPayload({
				from: fromAddr,
				to,
				subject,
				text,
				html,
				mailboxId: selectedMailboxId, externalSender: selectedExternalSender, replyToMessageId,
			}), parts.attachments, parts.inlineAttachments);
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

	const frameClass = composeFrameClass(mode);

	const isSending = loading;

	return (
		<>
			<ComposeToast toast={toast} />
			<form onSubmit={onSubmit} className={frameClass}>
				<ComposeHeader mode={mode} loadingDraft={loadingDraft} draftId={draft.draftId} onClose={onClose} />
				<ComposeSenderSelect mode={mode} selected={selectedExternalSender} nativeAddress={nativeFromAddr} senders={externalSenders} onChange={setExternalAccountId} />
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
				<ComposeFooter draftId={draft.draftId} sending={isSending} loadingDraft={loadingDraft} fromAddr={fromAddr}
					fileInputRef={fileInputRef} imageInputRef={imageInputRef} onFileChange={handleFileInputChange} onImageChange={handleInlineImageChange} />
			</form>
		</>
	);
}

export function ComposeForm(props: {
	mode?: "page" | "popup";
	draftIdToLoad?: string | null;
	onClose?: () => void;
} = {}) {
	return <ComposeFormContent {...props} mode={props.mode ?? "page"} />;
}
