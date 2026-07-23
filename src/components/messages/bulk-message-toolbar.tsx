"use client";

import { Archive, Mail, MailOpen, ShieldAlert, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import type { BulkMessageToolbarProps } from "./types";

export function BulkMessageToolbar({
	selectedCount,
	hasUnreadSelection,
	onAction,
	onClearSelection,
	pending,
}: BulkMessageToolbarProps) {
	const t = useTranslations("actions");
	const tm = useTranslations("messages");
	return (
		<div className="flex min-w-0 items-center gap-2 text-ink-muted w-full">
			<span className="mr-2 text-sm font-medium text-ink">{tm("selected", { count: selectedCount })}</span>
			<Tooltip label={t("archive")}>
				<Button variant="ghost" size="sm" onClick={() => onAction("archive")} disabled={pending} aria-label={t("archive")}>
					<Archive className="h-4 w-4" />
				</Button>
			</Tooltip>
			<Tooltip label={t("reportSpam")}>
				<Button variant="ghost" size="sm" onClick={() => onAction("spam")} disabled={pending} aria-label={t("reportSpam")}>
					<ShieldAlert className="h-4 w-4" />
				</Button>
			</Tooltip>
			<Tooltip label={t("delete")}>
				<Button variant="ghost" size="sm" onClick={() => onAction("trash")} disabled={pending} aria-label={t("delete")}>
					<Trash2 className="h-4 w-4" />
				</Button>
			</Tooltip>
			<Tooltip label={hasUnreadSelection ? t("markRead") : t("markUnread")}>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onAction(hasUnreadSelection ? "read" : "unread")}
					disabled={pending}
					aria-label={hasUnreadSelection ? t("markRead") : t("markUnread")}
				>
					{hasUnreadSelection ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
				</Button>
			</Tooltip>
			<Tooltip label={t("moveMessage")}>
				<span className="rounded-lg border border-border px-2">
					<select
						className="bg-surface-raised text-xs font-medium pb-1 text-ink-muted outline-none pr-2"
						disabled={pending}
						defaultValue=""
						aria-label={t("moveMessage")}
						onChange={(event) => {
							if (!event.target.value) return;
							onAction(event.target.value as BulkMessageAction);
							event.target.value = "";
						}}
					>
						<option value="">{t("moveTo")}</option>
						<option value="spam">{t("moveToSpam")}</option>
						<option value="trash">{t("moveToTrash")}</option>
					</select>
				</span>
			</Tooltip>
			<span className="flex-1" />
			<Tooltip label={t("clearSelection")}>
				<Button variant="ghost" size="sm" onClick={onClearSelection} disabled={pending} aria-label={t("clearSelection")}>
					<X className="h-4 w-4" />
				</Button>
			</Tooltip>
		</div>
	);
}
