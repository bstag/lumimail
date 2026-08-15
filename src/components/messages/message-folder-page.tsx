"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PanelBottom, PanelRight, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useCompose } from "@/components/compose/compose-context";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { invalidateMessageQueries, labelKeys } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMessages } from "@/hooks/use-messages";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth/client";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import { BulkMessageToolbar } from "./bulk-message-toolbar";
import type { MessageListRowProps, MessageFolderConfig } from "./types";
import {
	getPageRange,
	getMessageBadge,
	getMessageParty,
	getMessagePartyClassName,
	getMessagePreview,
	retryMessageDelivery,
	runBulkMessageAction,
} from "./utils";
import { canRecoverMessage } from "./message-folder-utils";
import { formatMessageListTime } from "./message-time-utils";
import { MOBILE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { canMailboxSend } from "@/components/mailbox-provider-utils";
import { MessageDetailView } from "./message-detail-view";
import { ResizableMailPanels } from "./resizable-mail-panels";
import {
	getConversationInitial,
	parseSelectedMessageId,
	parseSplitOrientation,
	type SplitOrientation,
} from "./desktop-split-utils";

const SPLIT_ORIENTATION_KEY = "lumimail:conversation-split-orientation";

const pageSize = 25;

type Label = { id: string; name: string; color: string };

async function fetchLabels(): Promise<Label[]> {
	const res = await authFetch("/api/labels");
	const json = (await res.json()) as { success: boolean; data?: Label[] };
	return json.data ?? [];
}

function MessageListRow({
	message,
	config,
	selected,
	onSelectedChange,
	onStarToggle,
	canSend = false,
	mailboxLabel,
	compact = false,
	timestamp,
	href,
	active = false,
}: MessageListRowProps) {
	const t = useTranslations("messages");
	const { openDraftComposer } = useCompose();
	const queryClient = useQueryClient();
	const [retrying, setRetrying] = useState(false);
	const [retryConfirmOpen, setRetryConfirmOpen] = useState(false);
	const unread = message.direction === "inbound" && !message.read;
	const showRetry = canRecoverMessage(config.folder, message.status, canSend);

	async function runRetry() {
		setRetryConfirmOpen(false);
		setRetrying(true);
		try {
			await retryMessageDelivery(queryClient, message.id);
		} finally {
			setRetrying(false);
		}
	}

	const retryButton = showRetry ? (
		<>
			<button
				type="button"
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					setRetryConfirmOpen(true);
				}}
				disabled={retrying}
				className="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-surface-subtle disabled:opacity-50"
			>
				{t("retryDelivery")}
			</button>
			<ConfirmDialog
				open={retryConfirmOpen}
				onOpenChange={setRetryConfirmOpen}
				title={t("retryDelivery")}
				// A failure can be ambiguous: the provider may have accepted the
				// message before the error surfaced. The operator decides whether
				// to accept that.
				description={t("retryDeliveryConfirm", { recipient: message.toAddr ?? "" })}
				confirmLabel={t("retryDelivery")}
				pending={retrying}
				onConfirm={runRetry}
			/>
		</>
	) : null;
	// Flex rather than a fixed grid: the grid gave the subject a `1fr` track that
	// the mailbox chip and the timestamp could squeeze to zero width on a phone,
	// which hid the subject entirely. Here the subject owns its own line at
	// compact widths and the meta cluster is `shrink-0` beside it.
	const className =
		`flex min-h-12 w-full items-center gap-2 px-4 text-left text-sm sm:gap-3 sm:px-6 hover:relative hover:z-10 hover:bg-surface-subtle hover:shadow-sm ${
			selected || active ? "bg-accent-muted" : ""
		}`;

	function handleStarClick(event: React.MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		onStarToggle(message.id, !message.starred);
	}

	const starButton = (
		<button
			type="button"
			onClick={handleStarClick}
			className="flex items-center justify-center p-1 rounded hover:bg-surface-subtle"
			aria-label={message.starred ? "Unstar" : "Star"}
		>
			<Star
				className={`h-4 w-4 ${message.starred ? "fill-warning text-warning" : "text-ink-faint"}`}
			/>
		</button>
	);

	/**
	 * Mailbox chip, folder badge, and timestamp. Rendered once — on the sender
	 * line when compact, at the end of the row otherwise. `compact` comes from a
	 * media query rather than `sm:hidden` so only one copy exists in the DOM;
	 * two would be read twice by a screen reader and would make every strict
	 * `getByText` locator in the suites ambiguous.
	 */
	const meta = (
		<div className="flex shrink-0 items-center gap-2">
			{mailboxLabel && (
				<Badge variant="outline" title={mailboxLabel}>
					{mailboxLabel}
				</Badge>
			)}
			{config.showRowBadge !== false && (
				<Badge variant={config.badgeVariant ?? "secondary"}>
					{getMessageBadge(message, config.folder)}
				</Badge>
			)}
			{timestamp && (
				<time
					dateTime={message.createdAt}
					className={`shrink-0 text-xs tabular-nums ${unread ? "font-semibold text-ink" : "text-ink-muted"}`}
				>
					{timestamp}
				</time>
			)}
		</div>
	);

	const content = (
		<div className="flex min-w-0 flex-1 items-center gap-3">
			<span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-muted text-xs font-semibold text-accent">
				{getConversationInitial(getMessageParty(message, config.folder))}
			</span>
		<div className={`flex min-w-0 flex-1 gap-0.5 ${
				compact ? "flex-col py-1.5" : "flex-row items-center gap-3"
			}`}>
			<div className={`flex min-w-0 items-center gap-2 ${compact ? "" : "w-40 shrink-0 sm:w-60"}`}>
				<span className={`${getMessagePartyClassName(message, config.folder)} ${compact ? "flex-1" : ""}`}>
					{getMessageParty(message, config.folder)}
				</span>
				{compact && meta}
			</div>
			<span className="min-w-0 flex-1 truncate text-ink-muted">
				<span className={unread ? "font-bold text-ink" : ""}>
					{message.subject ?? t("noSubject")}
				</span>
				<span className="text-ink-muted"> - {getMessagePreview(message, config.folder)}</span>
			</span>
			{(message.threadCount ?? 1) > 1 && (
				<Badge variant="outline" aria-label={`${message.threadCount} messages in thread`}>
					{message.threadCount}
				</Badge>
			)}
			{!compact && meta}
		</div>
		</div>
	);

	if (config.folder === "drafts") {
		return (
			<div className={className}>
				<input
					type="checkbox"
					checked={selected}
					onChange={(event) => onSelectedChange(message.id, event.target.checked)}
					className="h-4 w-4 shrink-0 rounded border-border-strong"
					aria-label={t("selectMessage")}
				/>
				{starButton}
				<button
					type="button"
					className="flex min-w-0 flex-1 text-left"
					onClick={() => openDraftComposer(message.id)}
				>
					{content}
				</button>
			</div>
		);
	}

	return (
		<div className={className}>
			<input
				type="checkbox"
				checked={selected}
				onChange={(event) => onSelectedChange(message.id, event.target.checked)}
				className="h-4 w-4 shrink-0 rounded border-border-strong"
				aria-label={t("selectMessage")}
			/>
			{starButton}
			<Link
				href={href ?? `${config.hrefPrefix}/${message.id}`}
				className="flex min-w-0 flex-1"
				data-message-row-id={message.id}
				aria-current={active ? "true" : undefined}
			>
				{content}
			</Link>
			{retryButton}
		</div>
	);
}

export function MessageFolderPage({ config }: { config: MessageFolderConfig }) {
	const t = useTranslations("messages");
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const {
		selectedMailbox,
		mailboxes,
		scopedMailboxId,
		allMailboxes,
		isLoading: mailboxesLoading,
	} = useSelectedMailbox();
	const { query } = useMailSearch();
	const [offset, setOffset] = useState(0);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [pendingBulkAction, setPendingBulkAction] = useState(false);
	const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
	const { data: labels = [] } = useQuery({ queryKey: labelKeys.all, queryFn: fetchLabels });
	// A label view pins its label; the chip row is for narrowing a folder and has
	// nothing left to narrow once the whole list is one label.
	const pinnedLabelId = config.labelId ?? null;
	const effectiveLabelId = pinnedLabelId ?? activeLabelId;
	const { messages, isLoading, total, limit, setMessages } = useMessages(config.folder, scopedMailboxId, {
		query,
		limit: pageSize,
		offset,
		labelId: effectiveLabelId ?? undefined,
	}, !mailboxesLoading);
	const hasActiveFilters = !!query.trim();
	const pageRange = getPageRange(offset, messages.length, total);
	const selectedMessages = useMemo(
		() => messages.filter((message) => selectedIds.includes(message.id)),
		[messages, selectedIds],
	);
	const hasUnreadSelection = selectedMessages.some((message) => !message.read);
	// One media-query listener for the whole list rather than one per row.
	const compact = useMediaQuery(MOBILE_QUERY);
	const splitDesktop = useMediaQuery("(min-width: 1200px)");
	const [splitOrientation, setSplitOrientation] = useState<SplitOrientation>("right");

	// Read after mount so the server render and first client render agree.
	useEffect(() => {
		setSplitOrientation(parseSplitOrientation(globalThis.localStorage.getItem(SPLIT_ORIENTATION_KEY)));
	}, []);

	function toggleSplitOrientation() {
		setSplitOrientation((current) => {
			const next = current === "right" ? "bottom" : "right";
			globalThis.localStorage.setItem(SPLIT_ORIENTATION_KEY, next);
			return next;
		});
	}
	const selectedMessageId = splitDesktop ? parseSelectedMessageId(new URLSearchParams(searchParams.toString())) : null;
	const [restoreFocusId, setRestoreFocusId] = useState<string | null>(null);
	// Every row formats against the same instant, so a list cannot show two
	// different "todays" if it renders across midnight.
	const renderedAt = useMemo(() => new Date(), [messages]);
	// Only built in all-mailboxes scope; every row shares one mailbox otherwise.
	const mailboxLabels = useMemo(
		() =>
			new Map(
				allMailboxes
					? mailboxes.map((mailbox) => [mailbox.id, `${mailbox.localPart}@${mailbox.hostname}`])
					: [],
			),
		[allMailboxes, mailboxes],
	);
	const allVisibleSelected = messages.length > 0 && messages.every((message) => selectedIds.includes(message.id));

	useEffect(() => {
		setOffset(0);
		setSelectedIds([]);
	}, [query, scopedMailboxId, config.folder, effectiveLabelId]);

	useEffect(() => {
		setSelectedIds([]);
	}, [offset]);

	useEffect(() => {
		if (!restoreFocusId || selectedMessageId) return;
		document.querySelector<HTMLElement>(`[data-message-row-id="${restoreFocusId}"]`)?.focus();
		setRestoreFocusId(null);
	}, [restoreFocusId, selectedMessageId]);

	function desktopMessageHref(messageId: string) {
		if (!splitDesktop) return `${config.hrefPrefix}/${messageId}`;
		const next = new URLSearchParams(searchParams.toString());
		next.set("message", messageId);
		return `${pathname}?${next.toString()}`;
	}

	function closeConversation() {
		if (!selectedMessageId) return;
		const closingId = selectedMessageId;
		const next = new URLSearchParams(searchParams.toString());
		next.delete("message");
		setRestoreFocusId(closingId);
		router.push(next.size > 0 ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
	}

	function updateSelectedMessage(messageId: string, selected: boolean) {
		setSelectedIds((current) =>
			selected ? [...new Set([...current, messageId])] : current.filter((id) => id !== messageId),
		);
	}

	function toggleAllVisible(selected: boolean) {
		const visibleIds = messages.map((message) => message.id);
		setSelectedIds((current) => {
			if (!selected) return current.filter((id) => !visibleIds.includes(id));
			return [...new Set([...current, ...visibleIds])];
		});
	}

	async function runSelectedAction(action: BulkMessageAction) {
		if (selectedIds.length === 0) return;

		setPendingBulkAction(true);
		try {
			await runBulkMessageAction(queryClient, selectedIds, action);
			setSelectedIds([]);
		} finally {
			setPendingBulkAction(false);
		}
	}

	const handleStarToggle = useCallback(async (messageId: string, starred: boolean) => {
		setMessages((current) =>
			current.map((m) => (m.id === messageId ? { ...m, starred } : m)),
		);
		try {
			const response = await authFetch(`/api/messages/${messageId}/starred`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ starred }),
			});
			if (!response.ok) throw new Error("Unable to update starred state");
			void invalidateMessageQueries(queryClient);
		} catch {
			setMessages((current) =>
				current.map((m) => (m.id === messageId ? { ...m, starred: !starred } : m)),
			);
		}
	}, [queryClient, setMessages]);

	const list = (
		<div className="flex h-full flex-col">
			{config.title && (
				<div className="flex items-center gap-2 border-b border-border px-6 py-2">
					<h1 className="truncate text-sm font-semibold text-ink">{config.title}</h1>
				</div>
			)}
			{!pinnedLabelId && labels.length > 0 && (
				<div className="flex items-center gap-2 border-b border-border px-6 py-2">
					<button
						type="button"
						onClick={() => setActiveLabelId(null)}
						className={`rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
							activeLabelId === null
								? "bg-surface-inverse text-ink-inverse"
								: "bg-surface-subtle text-ink-muted hover:bg-surface-subtle"
						}`}
					>
						All
					</button>
					{labels.map((label) => (
						<button
							key={label.id}
							type="button"
							onClick={() => setActiveLabelId(activeLabelId === label.id ? null : label.id)}
							className={`flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-medium transition-colors ${
								activeLabelId === label.id
									? "bg-surface-inverse text-ink-inverse"
									: "bg-surface-subtle text-ink-muted hover:bg-surface-subtle"
							}`}
						>
							<span
								className="h-2 w-2 rounded-full flex-shrink-0"
								style={{ backgroundColor: label.color }}
							/>
							{label.name}
						</button>
					))}
				</div>
			)}
			<div className="flex h-14 items-center justify-between border-b border-border px-6">
				<div className="flex items-center gap-3 w-full">
					<Tooltip label={t("selectAll")}>
						<input
							type="checkbox"
							checked={allVisibleSelected}
							disabled={messages.length === 0}
							onChange={(event) => toggleAllVisible(event.target.checked)}
							className="h-4 w-4 rounded border-border-strong"
							aria-label={t("selectAll")}
						/>
					</Tooltip>
					{selectedIds.length > 0 && (
						<BulkMessageToolbar
							selectedCount={selectedIds.length}
							hasUnreadSelection={hasUnreadSelection}
							onAction={runSelectedAction}
							onClearSelection={() => setSelectedIds([])}
							pending={pendingBulkAction}
						/>
					)}
				</div>
				{selectedIds.length === 0 && (
					<div className="flex items-center gap-2 text-ink-muted">
						{splitDesktop && selectedMessageId && (
							<Tooltip
								label={splitOrientation === "right"
									? "Move conversation panel below the list"
									: "Move conversation panel beside the list"}
							>
								<Button
									variant="ghost"
									size="sm"
									onClick={toggleSplitOrientation}
									aria-label={splitOrientation === "right"
										? "Move conversation panel below the list"
										: "Move conversation panel beside the list"}
								>
									{splitOrientation === "right"
										? <PanelBottom className="h-4 w-4" />
										: <PanelRight className="h-4 w-4" />}
								</Button>
							</Tooltip>
						)}
						<span className="text-xs text-ink-muted whitespace-nowrap">
							{t("pageRange", { start: pageRange.start, end: pageRange.end, total: pageRange.total })}
						</span>
						<Tooltip label={t("previousPage")}>
							<Button
								variant="ghost"
								size="sm"
								disabled={offset === 0 || isLoading}
								onClick={() => setOffset(Math.max(offset - limit, 0))}
								aria-label={t("previousPage")}
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
						</Tooltip>
						<Tooltip label={t("nextPage")}>
							<Button
								variant="ghost"
								size="sm"
								disabled={offset + messages.length >= total || isLoading}
								onClick={() => setOffset(offset + limit)}
								aria-label={t("nextPage")}
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</Tooltip>
					</div>
				)}
			</div>

			<div className="divide-y divide-border">
				{messages.map((message) => (
					<MessageListRow
						key={message.id}
						message={message}
						config={config}
						selected={selectedIds.includes(message.id)}
						onSelectedChange={updateSelectedMessage}
						onStarToggle={handleStarToggle}
						canSend={selectedMailbox ? canMailboxSend(selectedMailbox) : false}
						mailboxLabel={allMailboxes ? mailboxLabels.get(message.mailboxId ?? "") : undefined}
						compact={compact}
						timestamp={formatMessageListTime(message.createdAt, renderedAt)}
						href={desktopMessageHref(message.id)}
						active={message.id === selectedMessageId}
					/>
				))}
				{isLoading && <p className="px-6 py-4 text-sm text-ink-muted">{t("loading")}</p>}
				{!isLoading && messages.length === 0 && (
					<p className="px-6 py-4 text-sm text-ink-muted">
						{hasActiveFilters ? t("noMessagesFilter") : config.emptyText}
					</p>
				)}
			</div>
		</div>
	);

	if (!selectedMessageId) return list;
	return (
		<ResizableMailPanels
			list={list}
			orientation={splitOrientation}
			detail={<MessageDetailView messageId={selectedMessageId} presentation="panel" onClose={closeConversation} />}
		/>
	);
}
