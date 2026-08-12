"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Boxes, CheckCircle2, ClipboardCheck, Database, Server, ShieldCheck } from "lucide-react";

import { AuthGuard } from "@/components/auth/auth-guard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { parseApiResponse } from "@/lib/api/client-response";
import { authFetch } from "@/lib/auth/client";
import type { OperationsOverview, OperationsQueueStatus, OperationsStatus } from "@/lib/operations";

const statusLabel: Record<OperationsStatus | OperationsQueueStatus, string> = {
	healthy: "Healthy",
	attention: "Needs attention",
	unavailable: "Unavailable",
	unknown: "Not checked",
};

function StatusBadge({ status }: { status: OperationsStatus | OperationsQueueStatus }) {
	return <Badge variant={status === "healthy" ? "success" : "outline"}>{statusLabel[status]}</Badge>;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatTimestamp(value: string | null): string {
	if (!value) return "No observation recorded";
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

async function fetchOverview(): Promise<OperationsOverview> {
	const response = await authFetch("/api/admin/operations");
	if (!response.ok) throw new Error("Operations overview could not be loaded");
	return parseApiResponse<OperationsOverview>(response);
}

function OperationsContent() {
	const overview = useQuery({ queryKey: ["admin", "operations"], queryFn: fetchOverview });
	const data = overview.data;
	const OverallIcon = data?.status === "healthy" ? CheckCircle2 : data?.status === "attention" ? AlertTriangle : Server;
	const providerLabel = data?.readiness.provider === "cloudflare"
		? "Cloudflare"
		: data?.readiness.provider === "resend" ? "Resend" : "Unsupported";
	const evidenceLabels = {
		recovery: "Recovery",
		release: "Signed release",
		smoke: "Public smoke",
		mail_flow: "Mail flow",
	} as const;

	return (
		<div className="h-full overflow-auto">
			<PageHeader title="Operations" description="Read-only platform health and integrity evidence." className="mb-6" />
			{overview.isLoading && <p className="text-sm text-ink-muted">Loading operations evidence…</p>}
			{overview.isError && (
				<div className="rounded-xl bg-danger-muted p-4 text-sm text-danger">Operations evidence could not be loaded.</div>
			)}
			{data && (
				<div className="space-y-4">
					<div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-subtle p-4">
						<div className="flex items-center gap-3">
							<OverallIcon className="h-5 w-5 text-ink-muted" aria-hidden="true" />
							<div>
								<p className="font-medium text-ink" data-testid="overall-status">{statusLabel[data.status]}</p>
								<p className="text-xs text-ink-muted">Observed {formatTimestamp(data.observedAt)}</p>
							</div>
						</div>
						<StatusBadge status={data.status} />
					</div>

					<div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
						<Card>
							<CardHeader className="flex-row items-center justify-between gap-3">
								<div className="flex items-center gap-3"><Boxes className="h-5 w-5 text-accent" /><CardTitle>Application</CardTitle></div>
								<StatusBadge status="healthy" />
							</CardHeader>
							<CardContent><dl className="grid grid-cols-2 gap-4 text-sm">
								<div><dt className="text-ink-muted">Version</dt><dd className="mt-1 font-semibold text-ink">{data.application.version}</dd></div>
								<div><dt className="text-ink-muted">Schema</dt><dd className="mt-1 font-semibold text-ink">{data.application.schema}</dd></div>
							</dl></CardContent>
						</Card>

						<Card>
							<CardHeader className="flex-row items-center justify-between gap-3">
								<div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-accent" /><CardTitle>Runtime readiness</CardTitle></div>
								<StatusBadge status={data.readiness.status} />
							</CardHeader>
							<CardContent className="space-y-4 text-sm">
								<div className="flex items-end justify-between gap-4">
									<div><p className="text-ink-muted">Outbound provider</p><p className="mt-1 font-semibold text-ink">{providerLabel}</p></div>
									<p className="text-xs text-ink-muted">{data.readiness.readyCount} of {data.readiness.requiredCount} configured</p>
								</div>
								<dl className="grid grid-cols-2 gap-x-4 gap-y-2">
									{([
										["Storage", data.readiness.storage],
										["Queues", data.readiness.queues],
										["Delivery", data.readiness.delivery],
										["Service", data.readiness.service],
										["Assets", data.readiness.assets],
									] as const).map(([label, ready]) => (
										<div key={label} className="flex items-center justify-between gap-2">
											<dt className="text-ink-muted">{label}</dt>
											<dd className={ready ? "text-success" : "text-danger"}>{ready ? "Ready" : "Missing"}</dd>
										</div>
									))}
								</dl>
								<p className="text-xs text-ink-muted">Configuration presence only; provider inventory is verified by the operator doctor.</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex-row items-center justify-between gap-3">
								<div className="flex items-center gap-3"><Server className="h-5 w-5 text-accent" /><CardTitle>Queues</CardTitle></div>
								<StatusBadge status={data.queues.status} />
							</CardHeader>
							<CardContent className="space-y-4 text-sm">
								<div className="grid grid-cols-2 gap-4">
									<div><p className="text-ink-muted">Backlog</p><p className="mt-1 font-semibold text-ink">{data.queues.backlogCount} messages</p></div>
									<div><p className="text-ink-muted">Queued data</p><p className="mt-1 font-semibold text-ink">{formatBytes(data.queues.backlogBytes)}</p></div>
									<div><p className="text-ink-muted">Needs attention</p><p className="mt-1 font-semibold text-ink">{data.queues.attentionCount}</p></div>
									<div><p className="text-ink-muted">Stale jobs</p><p className="mt-1 font-semibold text-ink">{data.queues.staleJobCount}</p></div>
								</div>
								<p className="text-xs text-ink-muted">Last checked: {formatTimestamp(data.queues.checkedAt)}</p>
								<Link href="/queue-health" className="text-sm font-medium text-accent hover:underline">View queue diagnostics</Link>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex-row items-center justify-between gap-3">
								<div className="flex items-center gap-3"><Database className="h-5 w-5 text-accent" /><CardTitle>Storage retention</CardTitle></div>
								<StatusBadge status={data.retention.status} />
							</CardHeader>
							<CardContent className="space-y-4 text-sm">
								<div className="grid grid-cols-2 gap-4">
									<div><p className="text-ink-muted">Scanned</p><p className="mt-1 font-semibold text-ink">{data.retention.scanned} objects scanned</p></div>
									<div><p className="text-ink-muted">Orphans</p><p className="mt-1 font-semibold text-ink">{data.retention.orphanCount}</p></div>
									<div><p className="text-ink-muted">Orphan data</p><p className="mt-1 font-semibold text-ink">{formatBytes(data.retention.orphanBytes)}</p></div>
								</div>
								<p className="text-xs text-ink-muted">Oldest orphan: {formatTimestamp(data.retention.oldestOrphanAt)}</p>
							</CardContent>
						</Card>
					</div>

					<Card>
						<CardHeader className="flex-row items-center justify-between gap-3">
							<div className="flex items-center gap-3"><ClipboardCheck className="h-5 w-5 text-accent" /><CardTitle>Operational evidence</CardTitle></div>
							<StatusBadge status={data.evidence.status} />
						</CardHeader>
						<CardContent>
							<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
								{(Object.keys(evidenceLabels) as Array<keyof typeof evidenceLabels>).map((category) => {
									const record = data.evidence.records.find((item) => item.category === category);
									return (
										<div key={category} className="rounded-lg border border-border bg-surface-subtle p-3 text-sm">
											<div className="flex items-center justify-between gap-3">
												<p className="font-medium text-ink">{evidenceLabels[category]}</p>
												{record ? <Badge variant={record.outcome === "passed" ? "success" : "outline"}>{record.outcome === "passed" ? "Passed" : "Failed"}</Badge> : <Badge variant="outline">Not recorded</Badge>}
											</div>
											{record && <div className="mt-3 space-y-1 text-xs text-ink-muted">
												<p>{record.passedChecks} of {record.totalChecks} checks passed</p>
												<p>Observed {formatTimestamp(record.observedAt)}</p>
												<p>Recorded {formatTimestamp(record.recordedAt)}</p>
											</div>}
										</div>
									);
								})}
							</div>
							<p className="mt-4 text-xs text-ink-muted">Content-free operator results only. Source artifacts and credentials are never stored here.</p>
						</CardContent>
					</Card>
				</div>
			)}
		</div>
	);
}

export default function OperationsPage() {
	return <AuthGuard requireMailbox requireOrgOwner><OperationsContent /></AuthGuard>;
}
