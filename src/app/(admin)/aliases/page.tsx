"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AliasRow = {
	id: string;
	localPart: string;
	domainId: string;
	domainHostname: string;
	targetMailboxId: string | null;
	forwardTo: string | null;
	isGroup: boolean;
	createdAt: string;
};

type Domain = { id: string; hostname: string };
type Mailbox = { id: string; localPart: string; domainId: string; displayName: string | null };

export default function AliasesPage() {
	const [aliases, setAliases] = useState<AliasRow[]>([]);
	const [domains, setDomains] = useState<Domain[]>([]);
	const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [domainId, setDomainId] = useState("");
	const [localPart, setLocalPart] = useState("");
	const [targetMailboxId, setTargetMailboxId] = useState("");
	const [forwardTo, setForwardTo] = useState("");
	const [creating, setCreating] = useState(false);

	const load = useCallback(async () => {
		const [aRes, dRes, mRes] = await Promise.all([
			authFetch("/api/aliases"),
			authFetch("/api/domains"),
			authFetch("/api/mailboxes"),
		]);
		const aJson = (await aRes.json()) as { success: boolean; data?: { aliases: AliasRow[] } };
		const dJson = (await dRes.json()) as { domains: Domain[] };
		const mJson = (await mRes.json()) as { mailboxes: Mailbox[] };
		if (aJson.success) setAliases(aJson.data?.aliases ?? []);
		setDomains(dJson.domains ?? []);
		setMailboxes(mJson.mailboxes ?? []);
		setLoading(false);
	}, []);

	useEffect(() => { void load(); }, [load]);

	async function create() {
		if (!domainId || !localPart) return;
		setCreating(true);
		const body: Record<string, unknown> = { domainId, localPart };
		if (targetMailboxId) body.targetMailboxId = targetMailboxId;
		else if (forwardTo) body.forwardTo = forwardTo;
		const res = await authFetch("/api/aliases", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		try {
			await parseApiResponse(res);
			setLocalPart("");
			setTargetMailboxId("");
			setForwardTo("");
			void load();
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : "Failed to create alias");
		}
		setCreating(false);
	}

	async function remove(id: string) {
		if (!confirm("Delete this alias?")) return;
		const res = await authFetch(`/api/aliases/${id}`, { method: "DELETE" });
		if (res.ok) void load();
	}

	const domainHostname = (id: string) => domains.find((d) => d.id === id)?.hostname ?? "";

	if (loading) return <div className="p-8 text-sm text-neutral-500">Loading…</div>;

	return (
		<div className="space-y-6 max-w-3xl">
			<h1 className="text-2xl font-semibold">Aliases</h1>
			<p className="text-sm text-neutral-500">Create email aliases that forward to mailboxes or external addresses.</p>

			{error && <p className="text-sm text-red-600">{error}</p>}

			<Card>
				<CardHeader>
					<CardTitle>Create alias</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label>Local part</Label>
							<Input
								placeholder="support"
								value={localPart}
								onChange={(e) => setLocalPart(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label>Domain</Label>
							<select
								className="w-full h-10 rounded-md border border-neutral-200 px-3 text-sm"
								value={domainId}
								onChange={(e) => setDomainId(e.target.value)}
							>
								<option value="">Select domain</option>
								{domains.map((d) => (
									<option key={d.id} value={d.id}>{d.hostname}</option>
								))}
							</select>
						</div>
					</div>
					<div className="space-y-2">
						<Label>Deliver to mailbox</Label>
						<select
							className="w-full h-10 rounded-md border border-neutral-200 px-3 text-sm"
							value={targetMailboxId}
							onChange={(e) => { setTargetMailboxId(e.target.value); setForwardTo(""); }}
						>
							<option value="">— or forward to address below —</option>
							{mailboxes.map((m) => (
								<option key={m.id} value={m.id}>
									{m.localPart}@{domainHostname(m.domainId)}{m.displayName ? ` (${m.displayName})` : ""}
								</option>
							))}
						</select>
					</div>
					<div className="space-y-2">
						<Label>Forward to external address</Label>
						<Input
							type="email"
							placeholder="user@example.com"
							value={forwardTo}
							disabled={!!targetMailboxId}
							onChange={(e) => setForwardTo(e.target.value)}
						/>
					</div>
					<Button onClick={create} disabled={creating || !domainId || !localPart}>
						<Plus className="h-4 w-4 mr-2" />
						Create alias
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Active aliases</CardTitle>
				</CardHeader>
				<CardContent>
					{aliases.length === 0 ? (
						<p className="text-sm text-neutral-400">No aliases yet.</p>
					) : (
						<ul className="divide-y divide-neutral-100">
							{aliases.map((a) => (
								<li key={a.id} className="flex items-center justify-between py-3">
									<div className="flex items-center gap-2 text-sm">
										<span className="font-mono font-medium">
											{a.localPart}@{a.domainHostname}
										</span>
										<ArrowRight className="h-3 w-3 text-neutral-400" />
										<span className="text-neutral-600">
											{a.forwardTo ?? (a.targetMailboxId ? "mailbox" : "group")}
										</span>
									</div>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => remove(a.id)}
										className="text-red-500 hover:text-red-700"
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
