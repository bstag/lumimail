"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock3,
	RefreshCw,
	Server,
} from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { cn } from "@/lib/utils";
import type { QueueHealthSnapshot, QueueHealthStatus } from "@/lib/queue-health";
import type { QueueHealthResponse } from "./types";
import { PageHeader } from "@/components/ui/page-header";

const statusPresentation: Record<QueueHealthStatus, {
	labelKey: "queueStatusHealthy" | "queueStatusDelayed" | "queueStatusAttention" | "queueStatusUnavailable";
	className: string;
	icon: typeof Activity;
}> = {
	healthy: {
		labelKey: "queueStatusHealthy",
		className: "bg-success-muted text-success",
		icon: CheckCircle2,
	},
	delayed: {
		labelKey: "queueStatusDelayed",
		className: "bg-warning-muted text-warning",
		icon: Clock3,
	},
	attention: {
		labelKey: "queueStatusAttention",
		className: "bg-danger-muted text-danger",
		icon: AlertTriangle,
	},
	unavailable: {
		labelKey: "queueStatusUnavailable",
		className: "bg-surface-subtle text-ink-muted",
		icon: Server,
	},
};

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatTimestamp(value: string | null, noneLabel: string): string {
	if (!value) return noneLabel;
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "medium",
	}).format(new Date(value));
}

type AgeParts =
	| { unit: "seconds"; seconds: number }
	| { unit: "minutes"; minutes: number }
	| { unit: "hours"; hours: number; minutes: number };

function getAgeParts(value: string, checkedAt: string): AgeParts {
	const ageSeconds = Math.max(
		0,
		Math.floor((new Date(checkedAt).getTime() - new Date(value).getTime()) / 1000),
	);
	if (ageSeconds < 60) return { unit: "seconds", seconds: ageSeconds };
	const ageMinutes = Math.floor(ageSeconds / 60);
	if (ageMinutes < 60) return { unit: "minutes", minutes: ageMinutes };
	return { unit: "hours", hours: Math.floor(ageMinutes / 60), minutes: ageMinutes % 60 };
}

function QueueCard({ queue }: { queue: QueueHealthSnapshot }) {
	const t = useTranslations("admin");
	const presentation = statusPresentation[queue.status];
	const StatusIcon = presentation.icon;
	const formatAge = (value: string, checkedAt: string): string => {
		const age = getAgeParts(value, checkedAt);
		if (age.unit === "seconds") return t("ageSeconds", { seconds: age.seconds });
		if (age.unit === "minutes") return t("ageMinutes", { minutes: age.minutes });
		return t("ageHours", { hours: age.hours, minutes: age.minutes });
	};

	return (
		<Card>
			<CardHeader className="flex-row items-start justify-between gap-3">
				<div className="min-w-0">
					<CardTitle>{queue.label}</CardTitle>
					<p className="mt-1 text-xs text-ink-muted">
						{t("lastChecked", { timestamp: formatTimestamp(queue.checkedAt, t("noTimestamp")) })}
					</p>
				</div>
				<div className={cn(
					"flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
					presentation.className,
				)}>
					<StatusIcon className="h-3.5 w-3.5" />
					{t(presentation.labelKey)}
				</div>
			</CardHeader>
			<CardContent>
				<dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
					<div>
						<dt className="text-ink-muted">{t("queuedMessages")}</dt>
						<dd className="mt-1 text-lg font-semibold text-ink">{queue.backlogCount}</dd>
					</div>
					<div>
						<dt className="text-ink-muted">{t("queuedData")}</dt>
						<dd className="mt-1 text-lg font-semibold text-ink">
							{formatBytes(queue.backlogBytes)}
						</dd>
					</div>
					<div className="col-span-2">
						<dt className="text-ink-muted">{t("oldestQueuedMessage")}</dt>
						<dd className="mt-1 font-medium text-ink">
							{formatTimestamp(queue.oldestMessageAt, t("noTimestamp"))}
							{queue.oldestMessageAt && (
								<span className="ml-2 text-xs font-normal text-ink-muted">
									({formatAge(queue.oldestMessageAt, queue.checkedAt)})
								</span>
							)}
						</dd>
					</div>
					{queue.queue === "outbound" && (
						<div className="col-span-2">
							<dt className="text-ink-muted">{t("staleOutboundJobs")}</dt>
							<dd className="mt-1 font-medium text-ink">{queue.staleJobCount}</dd>
						</div>
					)}
				</dl>
				{queue.detail && (
					<p className="mt-4 rounded-lg bg-danger-muted px-3 py-2 text-sm text-danger">
						{queue.detail}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

async function fetchQueueHealth(method: "GET" | "POST"): Promise<QueueHealthResponse> {
	const response = await authFetch("/api/admin/queue-health", { method });
	if (!response.ok) throw new Error("Queue health could not be loaded");
	return parseApiResponse<QueueHealthResponse>(response);
}

function QueueHealthContent() {
	const t = useTranslations("admin");
	const queryClient = useQueryClient();
	const health = useQuery({
		queryKey: ["admin", "queue-health"],
		queryFn: () => fetchQueueHealth("GET"),
	});
	const check = useMutation({
		mutationFn: () => fetchQueueHealth("POST"),
		onSuccess: (data) => {
			queryClient.setQueryData(["admin", "queue-health"], data);
		},
	});
	const queues = health.data?.queues ?? [];
	const newestCheck = queues.reduce<number | null>((newest, queue) => {
		const checkedAt = new Date(queue.checkedAt).getTime();
		return newest === null || checkedAt > newest ? checkedAt : newest;
	}, null);
	const stale = newestCheck === null
		|| health.dataUpdatedAt - newestCheck > 3 * 60 * 1000;

	return (
		<div className="space-y-6">
			<div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
				<div>
					<PageHeader
						title={t("queueHealthTitle")}
						description={t("queueHealthDesc")}
					/>
				</div>
				<Button
					variant="outline"
					onClick={() => check.mutate()}
					disabled={check.isPending}
				>
					<RefreshCw className={cn("h-4 w-4", check.isPending && "animate-spin")} />
					{check.isPending ? t("checkingNow") : t("checkNow")}
				</Button>
			</div>

			{stale && !health.isLoading && (
				<div className="flex gap-3 rounded-xl border border-warning bg-warning-muted p-4 text-sm text-warning">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					<p>
						{queues.length === 0
							? t("noQueueCheckYet")
							: t("queueStatusStale")}
					</p>
				</div>
			)}

			{(health.isError || check.isError) && (
				<div className="rounded-xl bg-danger-muted p-4 text-sm text-danger">
					{t("queueHealthLoadFailed")}
				</div>
			)}

			{health.isLoading ? (
				<p className="text-sm text-ink-muted">{t("loadingQueueHealth")}</p>
			) : (
				<div className="grid gap-4 xl:grid-cols-3">
					{queues.map((queue) => <QueueCard key={queue.queue} queue={queue} />)}
				</div>
			)}

			<div className="rounded-xl bg-surface-subtle p-4 text-sm text-ink-muted">
				<p className="font-medium text-ink">{t("aboutPausedQueues")}</p>
				<p className="mt-1">
					{t("pausedQueuesInfo")}
				</p>
			</div>
		</div>
	);
}

export default function QueueHealthPage() {
	return (
		<AuthGuard requireMailbox requireOrgOwner>
			<QueueHealthContent />
		</AuthGuard>
	);
}
