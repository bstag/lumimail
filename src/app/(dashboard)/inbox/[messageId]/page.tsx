"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown } from "lucide-react";
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
import { fetchMessageDetail, getMessageBodyDisplay, getMessageHeaderParties } from "./utils";

type ThreadMessage = Message & {
	textBody: string | null;
	htmlBody: string | null;
};

type ThreadResponse = {
	messages: ThreadMessage[];
};

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
		<div
			className={`border border-border rounded-lg overflow-hidden transition-all duration-200 ${isCurrent ? "ring-2 ring-border-strong" : ""}`}
		>
			<button
				type="button"
				onClick={onToggle}
				className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-subtle transition-colors"
			>
				<div className="flex items-center gap-3 min-w-0">
					<div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-subtle flex items-center justify-center text-xs font-medium text-ink-muted">
						{(fromName || fromAddress).slice(0, 1).toUpperCase()}
					</div>
					<div className="min-w-0">
						<p className="text-sm font-medium text-ink truncate">
							{fromName || fromAddress}
							{fromName && (
								<span className="ml-1 font-normal text-ink-muted">&lt;{fromAddress}&gt;</span>
							)}
						</p>
						{!isExpanded && (
							<p className="text-xs text-ink-muted truncate">{msg.snippet ?? ""}</p>
						)}
					</div>
				</div>
				<div className="flex items-center gap-3 flex-shrink-0 ml-4">
					<span className="text-xs text-ink-faint">
						{dayjs(msg.createdAt).format("MMM DD, hh:mmA")}
					</span>
					<ChevronDown
						className={`h-4 w-4 text-ink-faint transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
					/>
				</div>
			</button>

			<div
				className={`transition-all duration-200 ease-in-out ${isExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 overflow-hidden"}`}
			>
				<div className="px-4 pb-4 pt-0 border-t border-border">
					<div className="email-body max-w-none text-ink mt-3">
						<MessageBody messageId={msg.id} body={bodyDisplay} variant="thread" />
					</div>
				</div>
			</div>
		</div>
	);
}

export default function MessageDetailPage() {
	const t = useTranslations("messages");
	const params = useParams<{ messageId: string }>();
	const messageId = params.messageId;
	// User toggles on thread items, overlaying the default of "only the current
	// message starts expanded".
	const [expandedOverrides, setExpandedOverrides] = useState<ReadonlyMap<string, boolean>>(
		new Map(),
	);
	// Read state changes made on this page (auto mark-read, manual toggles)
	// overlay the fetched value until a fresh payload arrives, matching the old
	// local-state behavior.
	const [readOverride, setReadOverride] = useState<boolean | null>(null);
	const [markedRead, setMarkedRead] = useState(false);
	const { mailboxes } = useSelectedMailbox();

	// Reset the per-message overlays when navigating to another message
	// (render-time state adjustment, per the React docs pattern).
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

	// The thread request depends on the detail payload: it only runs once a
	// threadId is known (the TanStack dependent-query replacement for the old
	// chained fetch).
	const threadQuery = useQuery({
		queryKey: messageKeys.thread(threadId ?? ""),
		enabled: threadId !== null,
		retry: false,
		queryFn: async () => {
			const threadRes = await authFetch(
				`/api/messages/thread/${encodeURIComponent(threadId as string)}`,
			);
			if (!threadRes.ok) return { messages: [] } satisfies ThreadResponse;
			return parseApiResponse<ThreadResponse>(threadRes);
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

	// The current message starts expanded; everything else starts collapsed.
	function isExpanded(id: string) {
		return expandedOverrides.get(id) ?? id === messageId;
	}

	function toggleExpanded(id: string) {
		setExpandedOverrides((prev) => {
			const next = new Map(prev);
			next.set(id, !(prev.get(id) ?? id === messageId));
			return next;
		});
	}

	if (detailQuery.isPending) {
		return <p className="px-6 py-4 text-sm text-ink-muted">{t("loading")}</p>;
	}

	if (!data?.message) {
		return <p className="px-6 py-4 text-sm text-ink-muted">{data?.error ?? t("messageNotFound")}</p>;
	}

	const { message, body } = data;
	const read = readOverride ?? message.read;
	// Auto-mark only the freshly opened unread message — never re-mark after a
	// manual "mark unread" (readOverride) or after this visit already marked it.
	const autoMarkRead =
		!markedRead && readOverride === null && message.direction === "inbound" && message.read === false;
	const { fromName, fromAddress, toName } = getMessageHeaderParties(message);
	const bodyDisplay = getMessageBodyDisplay(body?.textBody, body?.htmlBody, message.snippet);

	const canSend = canMailboxSend(
		mailboxes.find((mailbox) => mailbox.id === message.mailboxId),
	);

	return (
		<div className="h-full overflow-y-auto overflow-x-hidden">
			{autoMarkRead && (
				<MarkAsRead messageId={message.id} onMarkedRead={handleMarkedRead} />
			)}
			<div className="flex py-2 items-center justify-between gap-2 px-2 overflow-x-auto">
				<div className="flex items-center flex-row gap-6">
					<Link
						href={getMessageBackHref(message.direction, message.status)}
						className="rounded-full p-2 text-ink-muted hover:bg-surface-subtle"
					>
						<ArrowLeft className="h-5 w-5" />
					</Link>
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
				<h1 className="mb-4 text-2xl font-semibold text-ink">
					{message.subject ?? t("noSubject")}
				</h1>

				{showThread ? (
					<div className="flex flex-col gap-2 mb-4">
						<p className="text-xs text-ink-faint mb-1">
							{threadMessages.length} messages in thread
						</p>
						{threadMessages.map((msg) => (
							<ThreadItem
								key={msg.id}
								msg={msg}
								isExpanded={isExpanded(msg.id)}
								isCurrent={msg.id === messageId}
								onToggle={() => toggleExpanded(msg.id)}
							/>
						))}
					</div>
				) : (
					<>
						<div className="mb-6 flex items-start justify-between border-b border-border pb-5">
							<div>
								<p className="text-sm text-ink">
									<b>{fromName}</b> <span className="text-ink-muted">&lt;{fromAddress}&gt;</span>
								</p>
								<p className="text-xs text-ink-muted">
									{t("toRecipient", { name: toName })}
								</p>
							</div>
							<p className="text-xs text-ink-faint">
								{dayjs(message.createdAt).format("MMM DD, YYYY, hh:mmA")}
							</p>
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
