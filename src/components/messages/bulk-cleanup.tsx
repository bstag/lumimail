"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
	BACKLOG_PROMPT_THRESHOLD,
	CLEANUP_AGES,
	olderThan,
	previewViewAction,
	readBacklogDismissed,
	runViewAction,
	writeBacklogDismissed,
	type ViewQuery,
} from "./bulk-cleanup-utils";

/** Offered once a whole page is selected and the view holds more (F102). */
export function SelectAllInViewBar({ allVisibleSelected, pageCount, total, allInView, onSelectAll, onClear }: {
	allVisibleSelected: boolean; pageCount: number; total: number; allInView: boolean; onSelectAll: () => void; onClear: () => void;
}) {
	const t = useTranslations("messages");
	if (!allVisibleSelected || total <= pageCount) return null;
	return <div role="status" className="flex flex-wrap items-center justify-center gap-2 border-b border-border bg-surface-subtle px-6 py-2 text-sm text-ink-muted">
		{allInView
			? <><span>{t("allInViewSelected", { total })}</span><Button variant="ghost" size="sm" className="text-accent" onClick={onClear}>{t("clearSelection")}</Button></>
			: <><span>{t("pageSelected", { count: pageCount })}</span><Button variant="ghost" size="sm" className="text-accent" onClick={onSelectAll}>{t("selectAllInView", { total })}</Button></>}
	</div>;
}

/**
 * Whether bulk actions target the whole view. It holds only while the page stays fully
 * selected and the view is unchanged, so paging, filtering or deselecting ends it.
 */
export function useSelectAllInView(view: ViewQuery, allVisibleSelected: boolean) {
	const key = JSON.stringify(view);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	// Reselecting the page, or returning to this view, must not silently widen the selection again.
	if (selectedKey !== null && (!allVisibleSelected || selectedKey !== key)) setSelectedKey(null);
	return {
		allInView: selectedKey !== null && allVisibleSelected && selectedKey === key,
		selectAll: () => setSelectedKey(key),
		clear: () => setSelectedKey(null),
	};
}

type Pending = { days: number; count: number } | null;

/** Archive Inbox mail older than 7, 30 or 90 days in the current view, after showing the count. */
export function CleanUpMenu({ query }: { query: ViewQuery }) {
	const t = useTranslations("messages");
	const queryClient = useQueryClient();
	const [pending, setPending] = useState<Pending>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function attempt(work: () => Promise<void>) {
		setBusy(true);
		try {
			await work();
		} catch {
			setMessage(t("cleanUpFailed"));
		} finally {
			setBusy(false);
		}
	}

	const choose = (days: number) => attempt(async () => {
		setMessage(null);
		setPending({ days, count: await previewViewAction(olderThan(query, days), "archive") });
	});
	const confirm = (days: number) => attempt(async () => {
		const count = await runViewAction(queryClient, olderThan(query, days), "archive");
		setPending(null);
		setMessage(t("cleanUpDone", { count }));
	});

	return <div className="flex flex-wrap items-center gap-2">
		<Select size="sm" className="w-auto" aria-label={t("cleanUp")} value="" disabled={busy}
			onChange={(event) => { if (event.target.value) void choose(Number(event.target.value)); }}>
			<option value="">{t("cleanUp")}</option>
			{CLEANUP_AGES.map((days) => <option key={days} value={days}>{t("cleanUpOlder", { days })}</option>)}
		</Select>
		{pending && <span role="status" className="flex items-center gap-2 text-xs text-ink-muted">
			{t("cleanUpConfirm", { count: pending.count, days: pending.days })}
			{pending.count > 0 && <Button size="sm" disabled={busy} onClick={() => void confirm(pending.days)}>{t("archiveNow")}</Button>}
			<Button size="sm" variant="ghost" onClick={() => setPending(null)}>{t("cancel")}</Button>
		</span>}
		{message && <span role="status" className="text-xs text-ink-muted">{message}</span>}
	</div>;
}

/** On a large Other tab, offers to archive everything older than a week, once (F102). */
export function OtherBacklogPrompt({ query }: { query: ViewQuery }) {
	const t = useTranslations("messages");
	const queryClient = useQueryClient();
	const [dismissed, setDismissed] = useState(readBacklogDismissed);
	const [busy, setBusy] = useState(false);
	const weekOld = olderThan(query, 7);
	const backlog = useQuery({
		queryKey: ["messages", "backlog", weekOld],
		queryFn: () => previewViewAction(weekOld, "archive"),
		enabled: !dismissed,
	});
	if (dismissed || (backlog.data ?? 0) <= BACKLOG_PROMPT_THRESHOLD) return null;

	function dismiss() {
		writeBacklogDismissed();
		setDismissed(true);
	}

	async function archive() {
		setBusy(true);
		try {
			await runViewAction(queryClient, weekOld, "archive");
			dismiss();
		} catch {
			// The prompt stays, so the reader can try again.
		} finally {
			setBusy(false);
		}
	}

	return <div role="region" aria-label={t("backlogTitle")} className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-subtle px-6 py-3 text-sm">
		<span className="text-ink">{t("backlogPrompt", { count: backlog.data ?? 0 })}</span>
		<span className="flex gap-2">
			<Button size="sm" disabled={busy} onClick={() => void archive()}>{t("backlogArchive")}</Button>
			<Button size="sm" variant="ghost" onClick={dismiss}>{t("notNow")}</Button>
		</span>
	</div>;
}
