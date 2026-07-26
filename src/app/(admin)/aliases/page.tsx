"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ArrowRight, Users } from "lucide-react";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";

type AliasRow = {
	id: string;
	localPart: string;
	domainId: string;
	domainHostname: string;
	targetMailboxId: string | null;
	forwardTo: string | null;
	isGroup: boolean;
	createdAt: string;
	members: Array<{
		mailboxId: string;
		localPart: string;
		hostname: string;
	}>;
};

type Domain = { id: string; hostname: string };
type Mailbox = {
	id: string;
	localPart: string;
	domainId: string;
	hostname: string;
	displayName: string | null;
};

type AliasKind = "mailbox" | "group";

export default function AliasesPage() {
	const [aliases, setAliases] = useState<AliasRow[]>([]);
	const [domains, setDomains] = useState<Domain[]>([]);
	const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [domainId, setDomainId] = useState("");
	const [localPart, setLocalPart] = useState("");
	const [kind, setKind] = useState<AliasKind>("mailbox");
	const [targetMailboxId, setTargetMailboxId] = useState("");
	const [groupMailboxIds, setGroupMailboxIds] = useState<string[]>([]);
	const [groupEdits, setGroupEdits] = useState<Record<string, string[]>>({});
	const [creating, setCreating] = useState(false);
	const [savingGroupId, setSavingGroupId] = useState<string | null>(null);

	const load = useCallback(async () => {
		const [aRes, dRes, mRes] = await Promise.all([
			authFetch("/api/aliases"),
			authFetch("/api/domains"),
			authFetch("/api/admin/mailboxes"),
		]);
		const aJson = (await aRes.json()) as { success: boolean; data?: { aliases: AliasRow[] } };
		const dJson = (await dRes.json()) as { domains: Domain[] };
		const mJson = (await mRes.json()) as { mailboxes: Mailbox[] };
		if (aJson.success) {
			const nextAliases = aJson.data?.aliases ?? [];
			setAliases(nextAliases);
			setGroupEdits(Object.fromEntries(
				nextAliases
					.filter((alias) => alias.isGroup)
					.map((alias) => [alias.id, alias.members.map((member) => member.mailboxId)]),
			));
		}
		setDomains(dJson.domains ?? []);
		setMailboxes(mJson.mailboxes ?? []);
		setLoading(false);
	}, []);

	useEffect(() => { void load(); }, [load]);

	async function create() {
		if (!domainId || !localPart) return;
		if (kind === "mailbox" && !targetMailboxId) return;
		if (kind === "group" && groupMailboxIds.length < 2) return;
		setCreating(true);
		setError(null);
		const body = kind === "mailbox"
			? { kind, domainId, localPart, targetMailboxId }
			: { kind, domainId, localPart, mailboxIds: groupMailboxIds };
		const res = await authFetch("/api/aliases", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		try {
			await parseApiResponse(res);
			setLocalPart("");
			setTargetMailboxId("");
			setGroupMailboxIds([]);
			await load();
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : "Failed to create alias");
		}
		setCreating(false);
	}

	function toggleMailbox(
		current: string[],
		mailboxId: string,
		checked: boolean,
	): string[] {
		return checked
			? [...current, mailboxId]
			: current.filter((id) => id !== mailboxId);
	}

	async function saveGroup(aliasId: string) {
		const mailboxIds = groupEdits[aliasId] ?? [];
		if (mailboxIds.length < 2) {
			setError("A group needs at least two mailboxes.");
			return;
		}
		setSavingGroupId(aliasId);
		setError(null);
		const res = await authFetch(`/api/aliases/${aliasId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mailboxIds }),
		});
		try {
			await parseApiResponse(res);
			await load();
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : "Failed to update group");
		}
		setSavingGroupId(null);
	}

	async function remove(id: string) {
		if (!confirm("Delete this alias?")) return;
		setError(null);
		const res = await authFetch(`/api/aliases/${id}`, { method: "DELETE" });
		try {
			await parseApiResponse(res);
			await load();
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : "Failed to delete alias");
		}
	}

	const mailboxAddress = (id: string | null) => {
		const mailbox = mailboxes.find((candidate) => candidate.id === id);
		return mailbox ? `${mailbox.localPart}@${mailbox.hostname}` : "missing mailbox";
	};

	if (loading) return <div className="text-sm text-ink-muted">Loading…</div>;

	return (
		<div className="space-y-6">
			<PageHeader
				title="Aliases"
				description="Create internal mailbox aliases and groups across your managed domains."
			/>

			{error && <p className="text-sm text-danger">{error}</p>}

			<Card>
				<CardHeader>
					<CardTitle>Create alias</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="alias-type">Alias type</Label>
						<Select
							id="alias-type"
							value={kind}
							onChange={(event) => setKind(event.target.value as AliasKind)}
						>
							<option value="mailbox">Mailbox alias</option>
							<option value="group">Group alias</option>
						</Select>
					</div>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="alias-local-part">Local part</Label>
							<Input
								id="alias-local-part"
								placeholder="support"
								value={localPart}
								onChange={(e) => setLocalPart(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="alias-domain">Domain</Label>
							<Select
								id="alias-domain"
								value={domainId}
								onChange={(e) => setDomainId(e.target.value)}
							>
								<option value="">Select domain</option>
								{domains.map((d) => (
									<option key={d.id} value={d.id}>{d.hostname}</option>
								))}
							</Select>
						</div>
					</div>
					{kind === "mailbox" ? (
						<div className="space-y-2">
							<Label htmlFor="alias-target">Deliver to mailbox</Label>
							<Select
								id="alias-target"
								value={targetMailboxId}
								onChange={(event) => setTargetMailboxId(event.target.value)}
							>
								<option value="">Select mailbox</option>
								{mailboxes.map((mailbox) => (
									<option key={mailbox.id} value={mailbox.id}>
										{mailboxAddress(mailbox.id)}
										{mailbox.displayName ? ` (${mailbox.displayName})` : ""}
									</option>
								))}
							</Select>
						</div>
					) : (
						<MailboxChecklist
							mailboxes={mailboxes}
							selected={groupMailboxIds}
							onChange={(mailboxId, checked) => {
								setGroupMailboxIds((current) => toggleMailbox(current, mailboxId, checked));
							}}
						/>
					)}
					<p className="text-xs text-ink-faint">
						External forwarding is planned but is not enabled in this MVP.
					</p>
					<Button
						onClick={create}
						disabled={
							creating ||
							!domainId ||
							!localPart ||
							(kind === "mailbox" ? !targetMailboxId : groupMailboxIds.length < 2)
						}
					>
						<Plus className="h-4 w-4 mr-2" />
						{kind === "group" ? "Create group" : "Create alias"}
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Active aliases</CardTitle>
				</CardHeader>
				<CardContent>
					{aliases.length === 0 ? (
						<p className="text-sm text-ink-faint">No aliases yet.</p>
					) : (
						<ul className="divide-y divide-border">
							{aliases.map((a) => (
								<li key={a.id} className="space-y-3 py-4">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div className="flex items-center gap-2 text-sm">
											<span className="font-mono font-medium">
												{a.localPart}@{a.domainHostname}
											</span>
											<ArrowRight className="h-3 w-3 text-ink-faint" />
											<span className="text-ink-muted">
												{a.isGroup
													? `${a.members.length} mailbox group`
													: a.forwardTo
														? "legacy external forwarding is unavailable"
														: mailboxAddress(a.targetMailboxId)}
											</span>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => remove(a.id)}
											className="text-danger hover:text-danger"
											aria-label={`Delete ${a.localPart}@${a.domainHostname}`}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
									{a.isGroup && (
										<div className="rounded-md border border-border p-3 space-y-3">
											<div className="flex items-center gap-2 text-sm font-medium text-ink">
												<Users className="h-4 w-4" />
												Group members
											</div>
											<MailboxChecklist
												mailboxes={mailboxes}
												selected={groupEdits[a.id] ?? []}
												onChange={(mailboxId, checked) => {
													setGroupEdits((current) => ({
														...current,
														[a.id]: toggleMailbox(current[a.id] ?? [], mailboxId, checked),
													}));
												}}
												label={`Members for ${a.localPart}@${a.domainHostname}`}
											/>
											<Button
												size="sm"
												onClick={() => saveGroup(a.id)}
												disabled={
													savingGroupId === a.id ||
													(groupEdits[a.id]?.length ?? 0) < 2
												}
											>
												Save members
											</Button>
										</div>
									)}
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function MailboxChecklist({
	mailboxes,
	selected,
	onChange,
	label = "Group mailboxes",
}: {
	mailboxes: Mailbox[];
	selected: string[];
	onChange: (mailboxId: string, checked: boolean) => void;
	label?: string;
}) {
	return (
		<fieldset className="space-y-2 rounded-md border border-border p-3">
			<legend className="px-1 text-sm font-medium text-ink">{label}</legend>
			{mailboxes.length === 0 ? (
				<p className="text-sm text-ink-faint">No organization mailboxes are available.</p>
			) : (
				<div className="grid gap-2 sm:grid-cols-2">
					{mailboxes.map((mailbox) => {
						const address = `${mailbox.localPart}@${mailbox.hostname}`;
						return (
							<label key={mailbox.id} className="flex items-center gap-2 text-sm text-ink">
								<input
									type="checkbox"
									aria-label={address}
									checked={selected.includes(mailbox.id)}
									onChange={(event) => onChange(mailbox.id, event.target.checked)}
								/>
								<span>{address}</span>
							</label>
						);
					})}
				</div>
			)}
		</fieldset>
	);
}
