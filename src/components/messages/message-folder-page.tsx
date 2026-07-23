"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useCompose } from "@/components/compose/compose-context";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { useMessages } from "@/hooks/use-messages";
import { useQuery } from "@tanstack/react-query";
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
	runBulkMessageAction,
} from "./utils";

const pageSize = 25;

type Label = { id: string; name: string; color: string };

async function fetchLabels(): Promise<Label[]> {
	const res = await authFetch("/api/labels");
	const json = (await res.json()) as { success: boolean; data?: Label[] };
	return json.data ?? [];
}

function MessageListRow({ message, config, selected, onSelectedChange, onStarToggle }: MessageListRowProps) {
	const t = useTranslations("messages");
	const Icon = config.icon;
	const { openDraftComposer } = useCompose();
	const unread = message.direction === "inbound" && !message.read;
	const className =
		`grid min-h-12 w-full grid-cols-[24px_32px_minmax(160px,240px)_1fr_auto_auto] items-center gap-3 px-6 text-left text-sm hover:relative hover:z-10 hover:bg-surface-subtle hover:shadow-sm ${
			selected ? "bg-accent-muted" : ""
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

	const content = (
		<>
			<Icon className="h-4 w-4 text-ink-faint" />
			<span className={getMessagePartyClassName(message, config.folder)}>
				{getMessageParty(message, config.folder)}
			</span>
			<span className="truncate text-ink-muted">
				<span className={unread ? "font-bold text-ink" : ""}>
					{message.subject ?? t("noSubject")}
				</span>
				<span className="text-ink-muted"> - {getMessagePreview(message, config.folder)}</span>
			</span>
			{config.showRowBadge !== false && (
				<Badge variant={config.badgeVariant ?? "secondary"}>
					{getMessageBadge(message, config.folder)}
				</Badge>
			)}
		</>
	);

	if (config.folder === "drafts") {
		return (
			<div className={className}>
				<input
					type="checkbox"
					checked={selected}
					onChange={(event) => onSelectedChange(message.id, event.target.checked)}
					className="h-4 w-4 rounded border-border-strong"
					aria-label={t("selectMessage")}
				/>
				<button type="button" className="contents text-left" onClick={() => openDraftComposer(message.id)}>
					{content}
				</button>
				{starButton}
			</div>
		);
	}

	return (
		<div className={className}>
			<input
				type="checkbox"
				checked={selected}
				onChange={(event) => onSelectedChange(message.id, event.target.checked)}
				className="h-4 w-4 rounded border-border-strong"
				aria-label={t("selectMessage")}
			/>
			<Link href={`${config.hrefPrefix}/${message.id}`} className="contents">
				{content}
			</Link>
			{starButton}
		</div>
	);
}

export function MessageFolderPage({ config }: { config: MessageFolderConfig }) {
	const t = useTranslations("messages");
	const { selectedMailbox, isLoading: mailboxesLoading } = useSelectedMailbox();
	const { query } = useMailSearch();
	const [offset, setOffset] = useState(0);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [pendingBulkAction, setPendingBulkAction] = useState(false);
	const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
	const { data: labels = [] } = useQuery({ queryKey: ["labels"], queryFn: fetchLabels });
	const { messages, isLoading, total, limit, setMessages } = useMessages(config.folder, selectedMailbox?.id, {
		query,
		limit: pageSize,
		offset,
		labelId: activeLabelId ?? undefined,
	}, !mailboxesLoading);
	const headerIcons = config.headerIcons ?? [];
	const hasActiveFilters = !!query.trim();
	const pageRange = getPageRange(offset, messages.length, total);
	const selectedMessages = useMemo(
		() => messages.filter((message) => selectedIds.includes(message.id)),
		[messages, selectedIds],
	);
	const hasUnreadSelection = selectedMessages.some((message) => !message.read);
	const allVisibleSelected = messages.length > 0 && messages.every((message) => selectedIds.includes(message.id));

	useEffect(() => {
		setOffset(0);
		setSelectedIds([]);
	}, [query, selectedMailbox?.id, config.folder, activeLabelId]);

	useEffect(() => {
		setSelectedIds([]);
	}, [offset]);

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
			await runBulkMessageAction(selectedIds, action);
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
			await authFetch(`/api/messages/${messageId}/starred`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ starred }),
			});
		} catch {
			setMessages((current) =>
				current.map((m) => (m.id === messageId ? { ...m, starred: !starred } : m)),
			);
		}
	}, [setMessages]);

	return (
		<div className="flex h-full flex-col">
			{labels.length > 0 && (
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
					{selectedIds.length > 0 ? (
						<BulkMessageToolbar
							selectedCount={selectedIds.length}
							hasUnreadSelection={hasUnreadSelection}
							onAction={runSelectedAction}
							onClearSelection={() => setSelectedIds([])}
							pending={pendingBulkAction}
						/>
					) : (
						null
					)}
				</div>
				{selectedIds.length === 0 && (
					<div className="flex items-center gap-2 text-ink-muted">
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
						{headerIcons.map((HeaderIcon, index) => (
							<HeaderIcon key={index} className="h-4 w-4" />
						))}
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
}
