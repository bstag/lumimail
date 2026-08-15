"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, X } from "lucide-react";
import dayjs from "dayjs";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { MarkAsRead } from "@/components/mark-read";
import { MessageActions } from "@/components/message-actions/message-actions";
import { AttachmentList } from "@/components/messages/attachment-list";
import { MessageBody } from "@/components/messages/message-body";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { canMailboxSend } from "@/components/mailbox-provider-utils";
import { getMessageBackHref } from "@/components/message-actions/utils";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { getDisplayNameForAddress } from "@/lib/contacts/utils";
import { getEmailAddress } from "@/lib/email/address";
import { messageKeys } from "@/lib/query-keys";
import type { Message } from "@/hooks/types";
import {
	fetchMessageDetail,
	getMessageBodyDisplay,
	getMessageHeaderParties,
} from "@/app/(dashboard)/inbox/[messageId]/utils";

type ThreadMessage = Message & {
	textBody: string | null;
	htmlBody: string | null;
};

type ThreadResponse = { messages: ThreadMessage[] };

function ThreadItem({
	msg,
	isExpanded,
	isCurrent,
	onToggle,
}: {
	msg: ThreadMessage;
	isExpanded: boolean;
	isCurrent: boolean;
	onToggle: () => void;
}) {
	const fromName = getDisplayNameForAddress(msg.fromAddr, null);
	const fromAddress = getEmailAddress(msg.fromAddr);
	const bodyDisplay = getMessageBodyDisplay(msg.textBody, msg.htmlBody, msg.snippet);

	return (
		<div className={`overflow-hidden rounded-lg border border-border transition-all duration-200 ${isCurrent ? "ring-2 ring-border-strong" : ""}`}>
			<button type="button" onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface-subtle">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-xs font-medium text-ink-muted">
						{(fromName || fromAddress).slice(0, 1).toUpperCase()}
					</div>
					<div className="min-w-0">
						<p className="truncate text-sm font-medium text-ink">
							{fromName || fromAddress}
							{fromName && <span className="ml-1 font-normal text-ink-muted">&lt;{fromAddress}&gt;</span>}
						</p>
						{!isExpanded && <p className="truncate text-xs text-ink-muted">{msg.snippet ?? ""}</p>}
					</div>
				</div>
				<div className="ml-4 flex shrink-0 items-center gap-3">
					<span className="text-xs text-ink-faint">{dayjs(msg.createdAt).format("MMM DD, hh:mmA")}</span>
					<ChevronDown className={`h-4 w-4 text-ink-faint transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
				</div>
			</button>
			<div className={`transition-all duration-200 ease-in-out ${isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 overflow-hidden opacity-0"}`}>
				<div className="border-t border-border px-4 pb-4 pt-0">
					<div className="email-body mt-3 max-w-none text-ink">
						<MessageBody messageId={msg.id} body={bodyDisplay} variant="thread" />
					</div>
				</div>
			</div>
		</div>
	);
}

export function MessageDetailView({
	messageId,
	presentation = "page",
	onClose,
}: {
	messageId: string;
	presentation?: "page" | "panel";
	onClose?: () => void;
}) {
	const t = useTranslations("messages");
	const [expandedOverrides, setExpandedOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
	const [readOverride, setReadOverride] = useState<boolean | null>(null);
	const [markedRead, setMarkedRead] = useState(false);
	const { mailboxes } = useSelectedMailbox();
	const [prevMessageId, setPrevMessageId] = useState(messageId);
	if (prevMessageId !== messageId) {
		setPrevMessageId(messageId);
		setExpandedOverrides(new Map());
		setReadOverride(null);
		setMarkedRead(false);
	}

	const detailQuery = useQuery({
		queryKey: messageKeys.detail(messageId),
		queryFn: () => fetchMessageDetail(messageId),
		retry: false,
	});
	const data = detailQuery.data;
	const threadId = data?.message?.threadId ?? null;
	const threadQuery = useQuery({
		queryKey: messageKeys.thread(threadId ?? ""),
		enabled: threadId !== null,
		retry: false,
		queryFn: async () => {
			const response = await authFetch(`/api/messages/thread/${encodeURIComponent(threadId as string)}`);
			if (!response.ok) return { messages: [] } satisfies ThreadResponse;
			return parseApiResponse<ThreadResponse>(response);
		},
	});
	const threadMessages = useMemo(() => {
		const messages = threadQuery.data?.messages ?? [];
		return messages.length > 1 ? messages : [];
	}, [threadQuery.data]);
	const showThread = threadMessages.length > 1;

	const handleMarkedRead = useCallback(() => {
		setMarkedRead(true);
		setReadOverride(true);
	}, []);

	function isExpanded(id: string) {
		return expandedOverrides.get(id) ?? id === messageId;
	}

	function toggleExpanded(id: string) {
		setExpandedOverrides((previous) => {
			const next = new Map(previous);
			next.set(id, !(previous.get(id) ?? id === messageId));
			return next;
		});
	}

	if (detailQuery.isPending) return <p className="px-6 py-4 text-sm text-ink-muted">{t("loading")}</p>;
	if (!data?.message) return <p className="px-6 py-4 text-sm text-ink-muted">{data?.error ?? t("messageNotFound")}</p>;

	const { message, body } = data;
	const read = readOverride ?? message.read;
	const autoMarkRead = !markedRead && readOverride === null && message.direction === "inbound" && message.read === false;
	const { fromName, fromAddress, toName } = getMessageHeaderParties(message);
	const bodyDisplay = getMessageBodyDisplay(body?.textBody, body?.htmlBody, message.snippet);
	const canSend = canMailboxSend(mailboxes.find((mailbox) => mailbox.id === message.mailboxId));

	return (
		<div className="h-full overflow-y-auto overflow-x-hidden" data-testid={presentation === "panel" ? "conversation-panel-content" : undefined}>
			{autoMarkRead && <MarkAsRead messageId={message.id} onMarkedRead={handleMarkedRead} />}
			<div className="flex items-center justify-between gap-2 overflow-x-auto px-2 py-2">
				<div className="flex items-center gap-6">
					{presentation === "panel" ? (
						<button type="button" aria-label="Close conversation" onClick={onClose} className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle">
							<X className="h-5 w-5" />
						</button>
					) : (
						<Link href={getMessageBackHref(message.direction, message.status)} className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle">
							<ArrowLeft className="h-5 w-5" />
						</Link>
					)}
				</div>
				<MessageActions
					messageId={message.id}
					direction={message.direction}
					status={message.status}
					read={read}
					fromAddr={message.fromAddr}
					toAddr={message.toAddr}
					subject={message.subject}
					mailboxId={message.mailboxId}
					canSend={canSend}
					onActionSuccess={(action) => {
						if (action === "read") setReadOverride(true);
						if (action === "unread") setReadOverride(false);
					}}
				/>
			</div>
			<article className="px-6">
				<h1 className="mb-4 text-2xl font-semibold text-ink">{message.subject ?? t("noSubject")}</h1>
				{showThread ? (
					<div className="mb-4 flex flex-col gap-2">
						<p className="mb-1 text-xs text-ink-faint">{threadMessages.length} messages in thread</p>
						{threadMessages.map((threadMessage) => (
							<ThreadItem
								key={threadMessage.id}
								msg={threadMessage}
								isExpanded={isExpanded(threadMessage.id)}
								isCurrent={threadMessage.id === messageId}
								onToggle={() => toggleExpanded(threadMessage.id)}
							/>
						))}
					</div>
				) : (
					<>
						<div className="mb-6 flex items-start justify-between border-b border-border pb-5">
							<div>
								<p className="text-sm text-ink"><b>{fromName}</b> <span className="text-ink-muted">&lt;{fromAddress}&gt;</span></p>
								<p className="text-xs text-ink-muted">{t("toRecipient", { name: toName })}</p>
							</div>
							<p className="text-xs text-ink-faint">{dayjs(message.createdAt).format("MMM DD, YYYY, hh:mmA")}</p>
						</div>
						<div className="email-body max-w-none text-ink">
							<MessageBody messageId={message.id} body={bodyDisplay} variant="single" />
						</div>
					</>
				)}
				<AttachmentList messageId={message.id} />
			</article>
		</div>
	);
}
