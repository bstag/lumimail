"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Mail, MailOpen, MoreVertical, Reply, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import type { MessageActionsProps } from "./types";
import { getMessageActionRedirect, runSingleMessageAction } from "./utils";

export function MessageActions({
	messageId,
	direction,
	status,
	read,
	fromAddr,
	toAddr,
	subject,
	canSend = false,
}: MessageActionsProps) {
	const t = useTranslations("actions");
	const router = useRouter();

	function replyTo() {
		const replyAddr = direction === "inbound" ? fromAddr : toAddr;
		const params = new URLSearchParams();
		if (replyAddr) params.set("to", replyAddr);
		if (subject) params.set("subject", subject.startsWith("Re:") ? subject : `Re: ${subject}`);
		params.set("inReplyTo", messageId);
		router.push(`/compose?${params.toString()}`);
	}

	function forwardMsg() {
		const params = new URLSearchParams();
		if (subject) params.set("subject", subject.startsWith("Fwd:") ? subject : `Fwd: ${subject}`);
		params.set("forwardOf", messageId);
		router.push(`/compose?${params.toString()}`);
	}
	const [pendingAction, setPendingAction] = useState<BulkMessageAction | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function runAction(action: BulkMessageAction) {
		setPendingAction(action);
		setError(null);
		try {
			await runSingleMessageAction(messageId, action);
			const redirect = getMessageActionRedirect(action, direction);
			if (redirect) router.push(redirect);
			router.refresh();
		} catch {
			setError(t("updateFailed"));
		} finally {
			setPendingAction(null);
		}
	}

	const disabled = pendingAction !== null;
	const markAction: BulkMessageAction = read ? "unread" : "read";

	return (
		<div className="flex items-center gap-3 text-ink-muted">
			{error && <span className="text-xs text-danger">{error}</span>}
			<div className="flex items-center gap-2">
				{canSend && (
					<>
						<Tooltip label={t("reply")}>
							<Button type="button" variant="ghost" size="sm" aria-label={t("reply")} onClick={replyTo}>
								<Reply className="h-5 w-5" />
							</Button>
						</Tooltip>
						<Tooltip label="Forward">
							<Button type="button" variant="ghost" size="sm" aria-label="Forward" onClick={forwardMsg}>
								<Reply className="h-5 w-5 scale-x-[-1]" />
							</Button>
						</Tooltip>
					</>
				)}
				<Tooltip label={t("archive")}>
					<Button
						variant="ghost"
						size="sm"
						aria-label={t("archive")}
						disabled={disabled}
						onClick={() => runAction("archive")}
					>
						<Archive className="h-5 w-5" />
					</Button>
				</Tooltip>
				<Tooltip label={t("reportSpam")}>
					<Button
						variant="ghost"
						size="sm"
						aria-label={t("reportSpam")}
						disabled={disabled || status === "spam" || direction !== "inbound"}
						onClick={() => runAction("spam")}
					>
						<ShieldAlert className="h-5 w-5" />
					</Button>
				</Tooltip>
				<Tooltip label={t("delete")}>
					<Button
						variant="ghost"
						size="sm"
						aria-label="Move to trash"
						disabled={disabled || status === "trash"}
						onClick={() => runAction("trash")}
					>
						<Trash2 className="h-5 w-5" />
					</Button>
				</Tooltip>
				<Tooltip label={read ? t("markUnread") : t("markRead")}>
					<Button
						variant="ghost"
						size="sm"
						aria-label={read ? t("markUnread") : t("markRead")}
						disabled={disabled}
						onClick={() => runAction(markAction)}
					>
						{read ? <Mail className="h-5 w-5" /> : <MailOpen className="h-5 w-5" />}
					</Button>
				</Tooltip>
				<Tooltip label={t("moveMessage")}>
					<select
						className="h-8 rounded-lg border border-border bg-surface-raised px-2 text-xs text-ink-muted"
						disabled={disabled}
						defaultValue=""
						aria-label={t("moveMessage")}
						onChange={(event) => {
							if (!event.target.value) return;
							void runAction(event.target.value as BulkMessageAction);
							event.target.value = "";
						}}
					>
						<option value="">{t("moveTo")}</option>
						<option value="spam">{t("moveToSpam")}</option>
						<option value="trash">{t("moveToTrash")}</option>
					</select>
				</Tooltip>
				<Tooltip label={t("moreActions")}>
					<span aria-label={t("moreActions")} className="rounded-full p-1 text-ink-faint">
						<MoreVertical className="h-5 w-5" />
					</span>
				</Tooltip>
			</div>
		</div>
	);
}
