"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Copy, KeyRound, ShieldOff } from "lucide-react";
import { apiJson } from "@/lib/api/client-response";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Connection = {
	id: string;
	clientName: string;
	profile: "read" | "actions";
	status: "pending" | "active" | "revoked";
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
};

export function McpConnectionsClient() {
	const queryClient = useQueryClient();
	const [copied, setCopied] = useState(false);
	const [target, setTarget] = useState<Connection | null>(null);
	const [password, setPassword] = useState("");
	const endpoint = typeof window === "undefined" ? "/mcp" : `${window.location.origin}/mcp`;
	const query = useQuery({
		queryKey: ["mcp-connections"],
		queryFn: () => apiJson.get<{ connections: Connection[] }>("/api/mcp/connections"),
	});
	const revoke = useMutation({
		mutationFn: async (connection: Connection) => {
			await apiJson.post("/api/auth/reconfirm", { password });
			return apiJson.delete(`/api/mcp/connections/${connection.id}`);
		},
		onSuccess: async () => {
			setTarget(null);
			setPassword("");
			await queryClient.invalidateQueries({ queryKey: ["mcp-connections"] });
		},
		meta: { suppressErrorToast: true },
	});

	async function copyEndpoint() {
		try {
			await navigator.clipboard.writeText(endpoint);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	const connections = query.data?.connections ?? [];
	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-semibold text-ink">AI connections</h2>
				<p className="mt-1 text-sm text-ink-muted">Connect compatible assistants through OAuth without sharing a personal API key.</p>
			</div>
			<section className="space-y-3 rounded-lg border border-border p-4">
				<div className="flex items-start gap-3"><Bot className="mt-0.5 h-5 w-5 text-accent" /><div><h3 className="font-semibold text-ink">Lumimail MCP endpoint</h3><p className="text-sm text-ink-muted">Add this URL in your MCP client. New approvals default to read only.</p></div></div>
				<div className="flex flex-col gap-2 sm:flex-row"><code className="min-w-0 flex-1 break-all rounded-md bg-surface-subtle px-3 py-2 text-sm">{endpoint}</code><Button variant="outline" onClick={copyEndpoint}><Copy className="h-4 w-4" />{copied ? "Copied" : "Copy"}</Button></div>
				<p className="text-xs text-ink-muted">Mail actions require separate consent. Organization administration, credentials, sessions, operations, and backups are never exposed.</p>
			</section>

			<section className="space-y-3">
				<div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-ink">Connected clients</h3><Link href="/settings/api-keys" className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><KeyRound className="h-4 w-4" />Personal API keys</Link></div>
				{query.isLoading && <p role="status" className="text-sm text-ink-muted">Loading connections…</p>}
				{query.isError && <p role="alert" className="text-sm text-danger">{query.error.message}</p>}
				{!query.isLoading && connections.length === 0 && <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">No AI clients are connected.</div>}
				<div className="grid gap-3 md:grid-cols-2">
					{connections.map((connection) => (
						<article key={connection.id} className="space-y-3 rounded-lg border border-border p-4">
							<div className="flex items-start justify-between gap-2"><div><h4 className="font-semibold text-ink">{connection.clientName}</h4><p className="text-xs text-ink-muted">Connected {new Date(connection.createdAt).toLocaleString()}</p></div><Badge variant={connection.status === "active" ? "success" : "secondary"}>{connection.status}</Badge></div>
							<div className="flex items-center justify-between gap-2"><Badge variant="outline">{connection.profile === "actions" ? "Mail actions" : "Read only"}</Badge>{connection.lastUsedAt && <span className="text-xs text-ink-muted">Used {new Date(connection.lastUsedAt).toLocaleString()}</span>}</div>
							{connection.status === "active" && <Button size="sm" variant="outline" onClick={() => { setTarget(connection); revoke.reset(); }}><ShieldOff className="h-4 w-4" />Revoke</Button>}
						</article>
					))}
				</div>
			</section>

			<Dialog open={target !== null} onOpenChange={(open) => { if (!open) { setTarget(null); setPassword(""); revoke.reset(); } }}>
				<DialogContent>
					<DialogHeader><DialogTitle>Revoke {target?.clientName}?</DialogTitle><DialogDescription>This immediately invalidates its OAuth grant. Confirm your password to continue.</DialogDescription></DialogHeader>
					<div className="space-y-2"><Label htmlFor="mcp-revoke-password">Password</Label><Input id="mcp-revoke-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
					{revoke.isError && <p role="alert" className="text-sm text-danger">{revoke.error.message}</p>}
					<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button><Button variant="destructive" disabled={!password || revoke.isPending} onClick={() => target && revoke.mutate(target)}>{revoke.isPending ? "Revoking…" : "Revoke connection"}</Button></div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
