"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Minimize2, Paperclip, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { authFetch } from "@/lib/auth/client";
import { formatEmailAddress } from "@/lib/email/address";
import { cn } from "@/lib/utils";
import { fetchDraft, submitMessage, uploadMessageAttachment } from "./utils";

type Toast = { type: "success" | "error"; message: string } | null;

type AttachedFile = {
	file: File;
	id: string;
};

type MessageWithBodyResponse = {
	message?: { fromAddr?: string; toAddr?: string; subject?: string | null };
	body?: { textBody?: string | null; htmlBody?: string | null };
};

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
	const searchParams = useSearchParams();
	const { selectedMailbox, setSelectedMailbox, mailboxes } = useSelectedMailbox();
	const [draftId, setDraftId] = useState<string | null>(null);
	const [to, setTo] = useState("");
	const [subject, setSubject] = useState("");
	const [text, setText] = useState("");
	const [toast, setToast] = useState<Toast>(null);
	const [loading, setLoading] = useState(false);
	const [loadingDraft, setLoadingDraft] = useState(false);
	const [loadedDraftMailboxId, setLoadedDraftMailboxId] = useState<string | null>(null);
	const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
	const [uploadingAttachments, setUploadingAttachments] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const fromAddr = useMemo(
		() =>
			selectedMailbox
				? formatEmailAddress(
						`${selectedMailbox.localPart}@${selectedMailbox.hostname}`,
						selectedMailbox.displayName ?? selectedMailbox.localPart,
					)
				: "",
		[selectedMailbox],
	);

	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(() => setToast(null), 3200);
		return () => clearTimeout(timer);
	}, [toast]);

	useEffect(() => {
		if (!draftIdToLoad) return;

		let cancelled = false;
		setLoadingDraft(true);
		fetchDraft(draftIdToLoad)
			.then((draft) => {
				if (cancelled) return;

				setDraftId(draft.id);
				setTo(draft.toAddr);
				setSubject(draft.subject ?? "");
				setText(draft.textBody ?? "");
				setLoadedDraftMailboxId(draft.mailboxId);
			})
			.catch((err) => {
				if (cancelled) return;
				const message = err instanceof Error ? err.message : t("draftLoadFailed");
				setToast({ type: "error", message });
			})
			.finally(() => {
				if (!cancelled) setLoadingDraft(false);
			});

		return () => {
			cancelled = true;
		};
	}, [draftIdToLoad, t]);

	useEffect(() => {
		if (draftIdToLoad) return;
		const toParam = searchParams.get("to");
		const subjectParam = searchParams.get("subject");
		const forwardOf = searchParams.get("forwardOf");
		const inReplyTo = searchParams.get("inReplyTo");
		if (toParam) setTo(toParam);
		if (subjectParam) setSubject(subjectParam);
		const sourceId = forwardOf ?? inReplyTo;
		if (!sourceId) return;

		let cancelled = false;
		authFetch(`/api/messages/${sourceId}`)
			.then((res) => (res.ok ? (res.json() as Promise<MessageWithBodyResponse>) : null))
			.then((payload) => {
				if (cancelled || !payload?.body) return;
				const original = payload.body.textBody ?? "";
				const meta = payload.message;
				const quoted = `\n\n---------- ${forwardOf ? "Forwarded message" : "Original message"} ----------\nFrom: ${meta?.fromAddr ?? ""}\nSubject: ${meta?.subject ?? ""}\n\n${original}`;
				setText((current) => current + quoted);
			})
			.catch(() => {
				/* prefill is best-effort */
			});

		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchParams, draftIdToLoad]);

	useEffect(() => {
		if (!loadedDraftMailboxId) return;

		const draftMailbox = mailboxes.find((mailbox) => mailbox.id === loadedDraftMailboxId);
		if (draftMailbox) setSelectedMailbox(draftMailbox);
	}, [loadedDraftMailboxId, mailboxes, setSelectedMailbox]);

	useEffect(() => {
		const hasContent = to.trim() || subject.trim() || text.trim();
		if (!fromAddr || !hasContent || loadingDraft) return;
		if (saveTimer.current) clearTimeout(saveTimer.current);

		saveTimer.current = setTimeout(async () => {
			const payload = {
				mailboxId: selectedMailbox?.id,
				from: fromAddr,
				to,
				subject,
				text,
			};
			const res = await authFetch(draftId ? `/api/drafts/${draftId}` : "/api/drafts", {
				method: draftId ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const data = (await res.json()) as { draft?: { id: string } };
			if (res.ok && data.draft?.id) setDraftId(data.draft.id);
		}, 900);

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [draftId, fromAddr, loadingDraft, selectedMailbox?.id, subject, text, to]);

	function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
		const files = Array.from(event.target.files ?? []);
		const MAX_SIZE = 25 * 1024 * 1024;
		const oversized = files.filter((f) => f.size > MAX_SIZE);

		if (oversized.length > 0) {
			setToast({
				type: "error",
				message: `File(s) exceed 25MB: ${oversized.map((f) => f.name).join(", ")}`,
			});
		}

		const valid = files.filter((f) => f.size <= MAX_SIZE);
		setAttachedFiles((prev) => [
			...prev,
			...valid.map((file) => ({ file, id: `${file.name}-${file.size}-${Date.now()}` })),
		]);

		// Reset input so the same file can be re-added if removed
		if (fileInputRef.current) fileInputRef.current.value = "";
	}

	function removeAttachment(id: string) {
		setAttachedFiles((prev) => prev.filter((a) => a.id !== id));
	}

	async function uploadAttachments(messageId: string) {
		for (const attached of attachedFiles) {
			await uploadMessageAttachment(messageId, attached.file);
		}
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		try {
			const data = await submitMessage({
				from: fromAddr,
				to,
				subject,
				text,
				mailboxId: selectedMailbox?.id,
			});
			setLoading(false);

			if (attachedFiles.length > 0) {
				setUploadingAttachments(true);
				try {
					await uploadAttachments(data.messageId);
				} catch {
					setToast({ type: "error", message: "Message sent but some attachments failed to upload." });
				} finally {
					setUploadingAttachments(false);
				}
			}
		} catch (error) {
			setLoading(false);
			setToast({ type: "error", message: error instanceof Error ? error.message : t("sendFailed") });
			return;
		}

		if (draftId) {
			void authFetch(`/api/drafts/${draftId}`, { method: "DELETE" }).finally(() => {
				window.dispatchEvent(new Event("lumimail:messages-changed"));
			});
		}
		setDraftId(null);
		setTo("");
		setSubject("");
		setText("");
		setAttachedFiles([]);
		setToast({ type: "success", message: t("sendSuccess") });
		window.dispatchEvent(new Event("lumimail:messages-changed"));
	}

	const frameClass =
		mode === "popup"
			? "fixed bottom-4 right-4 z-40 flex h-[min(520px,calc(100vh-88px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl"
			: "flex h-full min-h-[720px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm";

	const isSending = loading || uploadingAttachments;

	return (
		<>
			{toast && (
				<div
					className={cn(
						"fixed right-6 top-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg",
						toast.type === "success" ? "bg-green-600 text-white" : "bg-red-600 text-white",
					)}
				>
					{toast.message}
				</div>
			)}
			<form onSubmit={onSubmit} className={frameClass}>
				<div className="flex h-9 items-center justify-between bg-neutral-800 px-4 text-sm font-medium text-white">
					<span>{loadingDraft ? t("loadingDraft") : draftId ? t("draftSaved") : t("newMessage")}</span>
					{mode === "popup" && (
						<div className="flex items-center gap-3 text-neutral-300">
							<Minimize2 className="h-4 w-4" />
							<button type="button" onClick={onClose}>
								<X className="h-4 w-4" />
							</button>
						</div>
					)}
				</div>
				<div className="border-b border-neutral-100 px-4 py-1">
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
				<div className="border-b border-neutral-100 px-4 py-1">
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
				<div className="border-b border-neutral-100 px-4 py-1">
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
				<div className="min-h-0 flex-1 px-4 py-2">
					<Label htmlFor={`${mode}-text`} className="sr-only">{t("body")}</Label>
					<Textarea
						id={`${mode}-text`}
						value={text}
						onChange={(event) => setText(event.target.value)}
						required
						disabled={loadingDraft}
						className="h-full min-h-full resize-none border-0 px-0 shadow-none focus-visible:ring-0"
					/>
				</div>
				{attachedFiles.length > 0 && (
					<div className="border-t border-neutral-100 px-4 py-2 flex flex-wrap gap-2">
						{attachedFiles.map((attached) => (
							<div
								key={attached.id}
								className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700"
							>
								<Paperclip className="h-3 w-3 text-neutral-400 flex-shrink-0" />
								<span className="max-w-[160px] truncate">{attached.file.name}</span>
								<span className="text-neutral-400">{formatFileSize(attached.file.size)}</span>
								<button
									type="button"
									onClick={() => removeAttachment(attached.id)}
									className="ml-0.5 rounded-full p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600"
									aria-label={`Remove ${attached.file.name}`}
								>
									<X className="h-3 w-3" />
								</button>
							</div>
						))}
					</div>
				)}
				<div className="flex items-center gap-3 border-t border-neutral-100 px-4 py-3">
					<input
						ref={fileInputRef}
						type="file"
						multiple
						className="sr-only"
						onChange={handleFileInputChange}
						aria-label="Attach files"
					/>
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						disabled={isSending || loadingDraft}
						className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
						title="Attach files"
					>
						<Paperclip className="h-4 w-4" />
					</button>
					<span className="flex-1" />
					<p className="text-xs text-neutral-500">
						{uploadingAttachments
							? "Uploading attachments…"
							: draftId
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
