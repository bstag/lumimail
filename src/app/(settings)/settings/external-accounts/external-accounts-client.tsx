"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Pause, Play, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client-response";

type ExternalAccount = {
	id: string;
	mailboxId: string;
	mailboxAddress?: string;
	ownerUserId: string;
	ownerName?: string | null;
	provider: "google" | "microsoft";
	externalAddress: string;
	status: "connecting" | "initial_sync" | "active" | "paused" | "reconnect_required" |
		"resync_required" | "error" | "disconnected";
	importMode: "from_now" | "recent_30_days";
	retainOriginal: boolean;
	lastSyncAt: string | null;
	lastErrorCode: string | null;
};

type Mailbox = {
	id: string;
	localPart: string;
	hostname: string;
	displayName: string | null;
	role?: "viewer" | "responder" | "manager";
};

async function reconfirm(password: string): Promise<void> {
	await apiJson.post("/api/auth/reconfirm", { password });
}

export function ExternalAccountsClient() {
	const queryClient = useQueryClient();
	const [mailboxId, setMailboxId] = useState("");
	const [importMode, setImportMode] = useState<"from_now" | "recent_30_days">("from_now");
	const [retainOriginal, setRetainOriginal] = useState(false);
	const [disclosureAccepted, setDisclosureAccepted] = useState(false);
	const [password, setPassword] = useState("");
	const [statusMessage, setStatusMessage] = useState("");

	const accounts = useQuery({
		queryKey: ["external-accounts"],
		queryFn: () => apiJson.get<{ accounts: ExternalAccount[] }>("/api/external-accounts"),
	});
	const mailboxes = useQuery({
		queryKey: ["mailboxes"],
		queryFn: () => apiJson.get<{ mailboxes: Mailbox[] }>("/api/mailboxes"),
	});
	const manageableMailboxes = (mailboxes.data?.mailboxes ?? []).filter((mailbox) => mailbox.role === "manager");

	const connect = useMutation({
		mutationFn: async (provider: "google" | "microsoft") => {
			await reconfirm(password);
			return apiJson.post<{ redirectTo: string }>("/api/external-accounts/oauth/start", {
				provider, mailboxId, importMode, retainOriginal,
			});
		},
		onSuccess: (result) => globalThis.location.assign(result.redirectTo),
		meta: { suppressErrorToast: true },
	});

	async function refreshAccounts(message: string) {
		setStatusMessage(message);
		await queryClient.invalidateQueries({ queryKey: ["external-accounts"] });
	}

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-semibold text-ink">External accounts</h2>
				<p className="mt-1 text-sm text-ink-muted">Read and send Google or Microsoft mail from a Lumimail mailbox. Sync is one-way into Lumimail.</p>
			</div>

			<section className="space-y-4 rounded-lg border border-border p-4">
				<div className="flex items-start gap-3"><Cloud className="mt-0.5 h-5 w-5 text-accent" /><div><h3 className="font-semibold text-ink">Connect an account</h3><p className="text-sm text-ink-muted">Provider authorization uses delegated OAuth. Lumimail never asks for the provider password.</p></div></div>
				<div className="grid gap-4 md:grid-cols-2">
					<div className="space-y-2"><Label htmlFor="external-mailbox">Target mailbox</Label><select id="external-mailbox" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={mailboxId} onChange={(event) => setMailboxId(event.target.value)}><option value="">Select a mailbox</option>{manageableMailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.displayName || `${mailbox.localPart}@${mailbox.hostname}`} ({mailbox.localPart}@{mailbox.hostname})</option>)}</select></div>
					<div className="space-y-2"><Label htmlFor="external-import-mode">Initial import</Label><select id="external-import-mode" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={importMode} onChange={(event) => setImportMode(event.target.value as typeof importMode)}><option value="from_now">From now</option><option value="recent_30_days">Last 30 days</option></select></div>
				</div>
				<label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={retainOriginal} onChange={(event) => setRetainOriginal(event.target.checked)} /><span><strong>Retain original copies</strong><span className="block text-ink-muted">Keeps exact MIME bytes for mail imported after this is enabled. This is not yet a complete backup or restore service.</span></span></label>
				<label className="flex items-start gap-3 rounded-md bg-surface-subtle p-3 text-sm"><input type="checkbox" className="mt-1" checked={disclosureAccepted} onChange={(event) => setDisclosureAccepted(event.target.checked)} /><span>I understand every Lumimail user with read access to the selected mailbox can read imported mail.</span></label>
				<div className="max-w-sm space-y-2"><Label htmlFor="external-password">Confirm your Lumimail password</Label><Input id="external-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
				<div className="flex flex-wrap gap-2"><Button disabled={!mailboxId || !password || !disclosureAccepted || connect.isPending} onClick={() => connect.mutate("google")}>Connect Google</Button><Button variant="outline" disabled={!mailboxId || !password || !disclosureAccepted || connect.isPending} onClick={() => connect.mutate("microsoft")}>Connect Microsoft</Button></div>
				{connect.isError && <p role="alert" className="text-sm text-danger">{connect.error.message}</p>}
			</section>

			{statusMessage && <p role="status" className="text-sm text-success">{statusMessage}</p>}
			<section className="space-y-3">
				<h3 className="font-semibold text-ink">Connected accounts</h3>
				{accounts.isLoading && <p role="status" className="text-sm text-ink-muted">Loading external accounts…</p>}
				{accounts.isError && <p role="alert" className="text-sm text-danger">{accounts.error.message}</p>}
				{!accounts.isLoading && (accounts.data?.accounts.length ?? 0) === 0 && <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">No external accounts are connected.</div>}
				<div className="grid gap-4 lg:grid-cols-2">{accounts.data?.accounts.map((account) => <ExternalAccountCard key={account.id} account={account} onChanged={refreshAccounts} />)}</div>
			</section>
		</div>
	);
}

function ExternalAccountCard({ account, onChanged }: { account: ExternalAccount; onChanged: (message: string) => Promise<void> }) {
	const [password, setPassword] = useState("");
	const action = useMutation({
		mutationFn: async (kind: "pause" | "resume" | "sync" | "reconnect" | "retain" | "disconnect") => {
			if (["reconnect", "retain", "disconnect"].includes(kind)) await reconfirm(password);
			if (kind === "pause" || kind === "resume") return apiJson.patch(`/api/external-accounts/${account.id}`, { status: kind === "pause" ? "paused" : "active" });
			if (kind === "sync") return apiJson.post(`/api/external-accounts/${account.id}/sync`, {});
			if (kind === "retain") return apiJson.patch(`/api/external-accounts/${account.id}`, { retainOriginal: true });
			if (kind === "disconnect") return apiJson.delete(`/api/external-accounts/${account.id}`);
			const result = await apiJson.post<{ redirectTo: string }>(`/api/external-accounts/${account.id}/reconnect`, {});
			globalThis.location.assign(result.redirectTo);
		},
		onSuccess: async (_result, kind) => {
			if (kind !== "reconnect") await onChanged(kind === "disconnect" ? "External account disconnected." : "External account updated.");
		},
		meta: { suppressErrorToast: true },
	});
	const needsReconnect = account.status === "reconnect_required" || account.status === "disconnected";
	return (
		<article className="space-y-4 rounded-lg border border-border p-4">
			<div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold text-ink">{account.externalAddress}</h4><p className="text-sm capitalize text-ink-muted">{account.provider} · {account.mailboxAddress ?? account.mailboxId}</p></div><Badge variant={account.status === "active" ? "success" : "secondary"}>{account.status.replaceAll("_", " ")}</Badge></div>
			<dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="text-ink-muted">Initial import</dt><dd>{account.importMode === "from_now" ? "From now" : "Last 30 days"}</dd></div><div><dt className="text-ink-muted">Original retention</dt><dd>{account.retainOriginal ? "Enabled" : "Off"}</dd></div><div className="col-span-2"><dt className="text-ink-muted">Last successful sync</dt><dd>{account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : "Not yet"}</dd></div></dl>
			{account.lastErrorCode && <p role="alert" className="rounded-md bg-surface-subtle p-2 text-sm text-danger">Action required: {account.lastErrorCode.replaceAll("_", " ")}</p>}
			<div className="flex flex-wrap gap-2">{account.status === "active" ? <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate("pause")}><Pause className="h-4 w-4" />Pause</Button> : account.status === "paused" ? <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate("resume")}><Play className="h-4 w-4" />Resume</Button> : null}<Button size="sm" variant="outline" disabled={action.isPending || account.status !== "active"} onClick={() => action.mutate("sync")}><RefreshCw className="h-4 w-4" />Sync now</Button>{!account.retainOriginal && <Button size="sm" variant="outline" disabled={action.isPending || !password} onClick={() => action.mutate("retain")}><ShieldCheck className="h-4 w-4" />Retain future originals</Button>}{needsReconnect && <Button size="sm" disabled={action.isPending || !password} onClick={() => action.mutate("reconnect")}><RefreshCw className="h-4 w-4" />Reconnect</Button>}</div>
			<div className="space-y-2"><Label htmlFor={`external-password-${account.id}`}>Password for sensitive actions</Label><Input id={`external-password-${account.id}`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
			<Button size="sm" variant="destructive" disabled={action.isPending || account.status === "disconnected" || !password} onClick={() => action.mutate("disconnect")}><Trash2 className="h-4 w-4" />Disconnect</Button>
			{action.isError && <p role="alert" className="text-sm text-danger">{action.error.message}</p>}
		</article>
	);
}
