"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { getDisplayNameForAddress } from "@/lib/contacts/utils";
import { invalidateMessageQueries } from "@/lib/query-keys";
import { chunkIds } from "./other-digest-utils";

type Digest = {
	total: number;
	senderCount: number;
	senders: Array<{ sender: string; fromAddr: string; count: number; unread: number; latestId: string; latestSubject: string | null }>;
	unreadIds: string[];
};

/** "Last 24 hours in Other": bulk mail grouped by sender, with mark-all-read (F99). */
export function OtherDigest({ mailboxId }: { mailboxId: string | null }) {
	const t = useTranslations("messages");
	const queryClient = useQueryClient();
	const digest = useQuery({
		queryKey: ["messages", "digest", mailboxId],
		queryFn: async () => {
			const query = mailboxId ? `?mailboxId=${encodeURIComponent(mailboxId)}` : "";
			return parseApiResponse<Digest>(await authFetch(`/api/messages/digest${query}`));
		},
	});
	const markAllRead = useMutation({
		mutationFn: async (ids: string[]) => {
			for (const chunk of chunkIds(ids)) {
				await authFetch("/api/messages/bulk", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ messageIds: chunk, action: "read" }),
				});
			}
		},
		onSettled: () => invalidateMessageQueries(queryClient),
	});
	const data = digest.data;
	if (!data || data.total === 0) return null;
	return <section aria-label={t("otherDigestTitle")} className="border-b border-border bg-surface-subtle px-6 py-3">
		<div className="flex flex-wrap items-center justify-between gap-2">
			<div>
				<h2 className="text-sm font-semibold text-ink">{t("otherDigestTitle")}</h2>
				<p className="text-xs text-ink-muted">{t("otherDigestSummary", { total: data.total, senders: data.senderCount })}</p>
			</div>
			{data.unreadIds.length > 0 && <Button variant="outline" size="sm" disabled={markAllRead.isPending} onClick={() => markAllRead.mutate(data.unreadIds)}>
				{t("markAllRead")}
			</Button>}
		</div>
		<ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
			{data.senders.map((group) => <li key={group.sender} className="flex min-w-0 items-baseline gap-2 text-sm">
				<span className={`shrink-0 ${group.unread > 0 ? "font-semibold text-ink" : "text-ink-muted"}`}>
					{getDisplayNameForAddress(group.fromAddr, null)}
				</span>
				<Link href={`/inbox/${encodeURIComponent(group.latestId)}`} className="min-w-0 truncate text-ink-muted hover:text-ink hover:underline">
					{group.latestSubject ?? t("noSubject")}
				</Link>
				{group.count > 1 && <span className="shrink-0 text-xs tabular-nums text-ink-faint">×{group.count}</span>}
			</li>)}
		</ul>
	</section>;
}
