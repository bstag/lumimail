"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { cn } from "@/lib/utils";
import type { QueueHealthSnapshot, QueueHealthStatus } from "@/lib/queue-health";
import type { QueueHealthResponse } from "./types";
import { PageHeader } from "@/components/ui/page-header";

const statusPresentation: Record<QueueHealthStatus, {
	label: string;
	className: string;
	icon: typeof Activity;
}> = {
	healthy: {
		label: "Healthy",
		className: "bg-success-muted text-success",
		icon: CheckCircle2,
	},
	delayed: {
		label: "Delayed",
		className: "bg-warning-muted text-warning",
		icon: Clock3,
	},
	attention: {
		label: "Needs attention",
		className: "bg-danger-muted text-danger",
		icon: AlertTriangle,
	},
	unavailable: {
		label: "Unavailable",
		className: "bg-surface-subtle text-ink-muted",
		icon: Server,
	},
};

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatTimestamp(value: string | null): string {
	if (!value) return "None";
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "medium",
	}).format(new Date(value));
}

function formatAge(value: string, checkedAt: string): string {
	const ageSeconds = Math.max(
		0,
		Math.floor((new Date(checkedAt).getTime() - new Date(value).getTime()) / 1000),
	);
	if (ageSeconds < 60) return `${ageSeconds}s old`;
	const ageMinutes = Math.floor(ageSeconds / 60);
	if (ageMinutes < 60) return `${ageMinutes}m old`;
	return `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m old`;
}

function QueueCard({ queue }: { queue: QueueHealthSnapshot }) {
	const presentation = statusPresentation[queue.status];
	const StatusIcon = presentation.icon;

	return (
		<Card>
			<CardHeader className="flex-row items-start justify-between gap-3">
				<div className="min-w-0">
					<CardTitle>{queue.label}</CardTitle>
					<p className="mt-1 text-xs text-ink-muted">
						Last checked {formatTimestamp(queue.checkedAt)}
					</p>
				</div>
				<div className={cn(
					"flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
					presentation.className,
				)}>
					<StatusIcon className="h-3.5 w-3.5" />
					{presentation.label}
				</div>
			</CardHeader>
			<CardContent>
				<dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
					<div>
						<dt className="text-ink-muted">Queued messages</dt>
						<dd className="mt-1 text-lg font-semibold text-ink">{queue.backlogCount}</dd>
					</div>
					<div>
						<dt className="text-ink-muted">Queued data</dt>
						<dd className="mt-1 text-lg font-semibold text-ink">
							{formatBytes(queue.backlogBytes)}
						</dd>
					</div>
					<div className="col-span-2">
						<dt className="text-ink-muted">Oldest queued message</dt>
						<dd className="mt-1 font-medium text-ink">
							{formatTimestamp(queue.oldestMessageAt)}
							{queue.oldestMessageAt && (
								<span className="ml-2 text-xs font-normal text-ink-muted">
									({formatAge(queue.oldestMessageAt, queue.checkedAt)})
								</span>
							)}
						</dd>
					</div>
					{queue.queue === "outbound" && (
						<div className="col-span-2">
							<dt className="text-ink-muted">Stale outbound jobs</dt>
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
	return response.json() as Promise<QueueHealthResponse>;
}

function QueueHealthContent() {
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
						title="Queue health"
						description="Platform-wide delivery health for this Lumimail deployment. These numbers are not scoped to the selected mailbox or domain."
					/>
				</div>
				<Button
					variant="outline"
					onClick={() => check.mutate()}
					disabled={check.isPending}
				>
					<RefreshCw className={cn("h-4 w-4", check.isPending && "animate-spin")} />
					{check.isPending ? "Checking…" : "Check now"}
				</Button>
			</div>

			{stale && !health.isLoading && (
				<div className="flex gap-3 rounded-xl border border-warning bg-warning-muted p-4 text-sm text-warning">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					<p>
						{queues.length === 0
							? "No scheduled queue check has completed yet. Run Check now or verify the Cron Trigger after deployment."
							: "Queue status is more than three minutes old. The scheduled check may not be running."}
					</p>
				</div>
			)}

			{(health.isError || check.isError) && (
				<div className="rounded-xl bg-danger-muted p-4 text-sm text-danger">
					Queue health could not be loaded. Try again or inspect Worker logs.
				</div>
			)}

			{health.isLoading ? (
				<p className="text-sm text-ink-muted">Loading queue health…</p>
			) : (
				<div className="grid gap-4 xl:grid-cols-3">
					{queues.map((queue) => <QueueCard key={queue.queue} queue={queue} />)}
				</div>
			)}

			<div className="rounded-xl bg-surface-subtle p-4 text-sm text-ink-muted">
				<p className="font-medium text-ink">About paused queues</p>
				<p className="mt-1">
					Cloudflare queue metrics do not expose the administrative pause flag.
					A paused consumer will appear here once its backlog ages or an outbound
					job becomes stale. Resume or purge operations remain in Cloudflare or
					Wrangler.
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
