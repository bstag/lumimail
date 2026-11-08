"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Archive, ChevronDown, ChevronRight, ListFilter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { getDisplayNameForAddress } from "@/lib/contacts/utils";
import { filterLikeThisHref } from "@/app/(dashboard)/filters/utils";
import { runViewAction, type ViewQuery } from "./bulk-cleanup-utils";
import { formatMessageListTime } from "./message-time-utils";
import {
	MAX_SENDERS,
	SENDER_PAGE,
	fetchSenderGroups,
	fetchSenderMessages,
	readGroupBySender,
	subscribeGroupBySender,
	withSender,
	writeGroupBySender,
	type SenderGroup,
} from "./sender-groups-utils";

/** The device's Group by sender choice (F103). */
export function useGroupBySender(): [boolean, (next: boolean) => void] {
	const value = useSyncExternalStore(subscribeGroupBySender, readGroupBySender, () => false);
	return [value, writeGroupBySender];
}

export function GroupBySenderToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
	const t = useTranslations("messages");
	return <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
		<input type="checkbox" className="rounded" checked={value} onChange={(event) => onChange(event.target.checked)} />
		{t("groupBySender")}
	</label>;
}

function SenderMessages({ view, sender }: { view: ViewQuery; sender: string }) {
	const t = useTranslations("messages");
	const rows = useQuery({ queryKey: ["messages", "sender", view, sender], queryFn: () => fetchSenderMessages(view, sender) });
	if (!rows.data) return <p className="px-14 py-2 text-xs text-ink-muted">{t("loading")}</p>;
	const now = new Date();
	return <ul className="pb-2">
		{rows.data.map((message) => <li key={message.id}>
			<Link href={`/inbox/${encodeURIComponent(message.id)}`} className="flex min-w-0 items-baseline gap-3 px-14 py-1 text-sm hover:bg-surface-subtle">
				<span className={`min-w-0 flex-1 truncate ${message.read ? "text-ink-muted" : "font-semibold text-ink"}`}>{message.subject ?? t("noSubject")}</span>
				<time dateTime={message.createdAt} className="shrink-0 text-xs tabular-nums text-ink-faint">{formatMessageListTime(message.createdAt, now)}</time>
			</Link>
		</li>)}
	</ul>;
}

function SenderRow({ group, view, now }: { group: SenderGroup; view: ViewQuery; now: Date }) {
	const t = useTranslations("messages");
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const name = getDisplayNameForAddress(group.fromAddr, null);

	async function archiveAll() {
		setBusy(true);
		try {
			await runViewAction(queryClient, withSender(view, group.sender), "archive");
		} catch {
			setBusy(false);
		}
	}

	return <li>
		<div className="flex min-w-0 items-center gap-3 px-6 py-2">
			<button type="button" aria-expanded={open} aria-label={t(open ? "collapseSender" : "expandSender", { sender: name })}
				onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
				{open ? <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint" /> : <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />}
				<span className={`w-40 shrink-0 truncate sm:w-60 ${group.unread > 0 ? "font-semibold text-ink" : "text-ink-muted"}`}>{name}</span>
				<Badge variant="outline" aria-label={t("senderCount", { count: group.count, unread: group.unread })}>{group.count}</Badge>
				<span className="hidden min-w-0 flex-1 truncate text-sm text-ink-muted md:inline">{group.latestSubject ?? t("noSubject")}</span>
				<time dateTime={group.latestAt} className="shrink-0 text-xs tabular-nums text-ink-muted">{formatMessageListTime(group.latestAt, now)}</time>
			</button>
			<Tooltip label={t("archiveSender")}>
				<Button variant="ghost" size="sm" disabled={busy} aria-label={t("archiveSenderNamed", { sender: name })} onClick={() => void archiveAll()}>
					<Archive className="h-4 w-4" />
				</Button>
			</Tooltip>
			<Tooltip label={t("filterSender")}>
				<Link href={filterLikeThisHref(group.sender)} aria-label={t("filterSenderNamed", { sender: name })}
					className="rounded-md p-1.5 text-ink-muted hover:bg-surface-subtle hover:text-ink">
					<ListFilter className="h-4 w-4" />
				</Link>
			</Tooltip>
		</div>
		{open && <SenderMessages view={view} sender={group.sender} />}
	</li>;
}

/** The Inbox view as one row per sender, newest first (F103). */
export function SenderGroups({ view }: { view: ViewQuery }) {
	const t = useTranslations("messages");
	const [limit, setLimit] = useState(SENDER_PAGE);
	const groups = useQuery({ queryKey: ["messages", "senders", view, limit], queryFn: () => fetchSenderGroups(view, limit) });
	const data = groups.data;
	if (!data) return <p className="px-6 py-4 text-sm text-ink-muted">{t(groups.isError ? "sendersFailed" : "loading")}</p>;
	if (data.senders.length === 0) return <p className="px-6 py-4 text-sm text-ink-muted">{t("noMessagesFilter")}</p>;
	const now = new Date();
	return <div>
		<ul aria-label={t("groupBySender")} className="divide-y divide-border">
			{data.senders.map((group) => <SenderRow key={group.sender} group={group} view={view} now={now} />)}
		</ul>
		{data.total > data.senders.length && limit < MAX_SENDERS && <div className="px-6 py-3">
			<Button variant="outline" size="sm" onClick={() => setLimit(limit + SENDER_PAGE)}>{t("moreSenders")}</Button>
		</div>}
	</div>;
}
