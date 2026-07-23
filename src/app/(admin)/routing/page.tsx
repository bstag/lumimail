"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth/client";
import {
	canSubmitRoutingRule,
	filterMailboxesByDomain,
	readRoutingResponse,
	sortRoutingRules,
} from "./utils";

type RoutingRule = {
	id: string;
	pattern: string;
	action: "store" | "forward" | "reject";
	mailboxId: string | null;
	forwardTo: string | null;
	priority: number;
	domainId: string;
};

type Domain = { id: string; hostname: string };
type Mailbox = { id: string; localPart: string; domainId: string; displayName: string | null };

export default function RoutingPage() {
	const qc = useQueryClient();
	const [pattern, setPattern] = useState("*");
	const [domainId, setDomainId] = useState("");
	const [action, setAction] = useState<"store" | "forward" | "reject">("store");
	const [mailboxId, setMailboxId] = useState("");
	const [forwardTo, setForwardTo] = useState("");
	const [priority, setPriority] = useState(10);

	const domains = useQuery({
		queryKey: ["domains"],
		queryFn: async () => {
			const res = await authFetch("/api/domains");
			return (await res.json()) as { domains: Domain[] };
		},
	});

	const mailboxes = useQuery({
		queryKey: ["mailboxes"],
		queryFn: async () => {
			const res = await authFetch("/api/mailboxes");
			return (await res.json()) as { mailboxes: Mailbox[] };
		},
	});

	const rules = useQuery({
		queryKey: ["routing-rules"],
		queryFn: async () => {
			const res = await authFetch("/api/routing-rules");
			return (await res.json()) as { rules: RoutingRule[] };
		},
	});

	const create = useMutation({
		mutationFn: async () => {
			const body: Record<string, unknown> = { domainId, pattern, action, priority };
			if (action === "store" && mailboxId) body.mailboxId = mailboxId;
			if (action === "forward" && forwardTo) body.forwardTo = forwardTo;
			const res = await authFetch("/api/routing-rules", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			await readRoutingResponse(res);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["routing-rules"] });
			setPattern("*");
			setMailboxId("");
			setForwardTo("");
		},
	});

	const remove = useMutation({
		mutationFn: async (id: string) => {
			const rule = rules.data?.rules.find((candidate) => candidate.id === id);
			if (rule?.pattern === "*" && !confirm("Remove this catch-all and disable unmatched delivery for this domain?")) return;
			const res = await authFetch(`/api/routing-rules/${id}`, { method: "DELETE" });
			await readRoutingResponse(res);
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["routing-rules"] }),
	});

	const domainHostname = (id: string) =>
		domains.data?.domains.find((d) => d.id === id)?.hostname ?? "";

	const actionLabel = (rule: RoutingRule) => {
		if (rule.action === "store" && rule.mailboxId) return `→ mailbox`;
		if (rule.action === "forward" && rule.forwardTo) return `→ ${rule.forwardTo}`;
		return rule.action;
	};
	const selectedHostname = domainHostname(domainId);
	const availableMailboxes = filterMailboxesByDomain(mailboxes.data?.mailboxes ?? [], domainId);
	const isCatchAllInput = pattern.trim() === "*" || pattern.trim().toLowerCase() === `*@${selectedHostname.toLowerCase()}`;
	const canSubmit = canSubmitRoutingRule({ domainId, pattern, action, mailboxId, forwardTo });

	return (
		<div className="space-y-6 max-w-2xl">
			<h1 className="text-2xl font-semibold text-ink">Routing rules</h1>
			<p className="text-sm text-ink-muted">
				Named addresses are matched before real mailboxes; catch-all runs only for otherwise unmatched addresses. Priority applies within each match type.
			</p>

			<Card>
				<CardHeader>
					<CardTitle>Add rule</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="routing-domain">Domain</Label>
							<select
								id="routing-domain"
								className="w-full h-10 rounded-md border border-border px-3 text-sm"
								value={domainId}
								onChange={(e) => { setDomainId(e.target.value); setMailboxId(""); }}
							>
								<option value="">Select domain</option>
								{(domains.data?.domains ?? []).map((d) => (
									<option key={d.id} value={d.id}>{d.hostname}</option>
								))}
							</select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="routing-pattern">Pattern</Label>
							<Input
								id="routing-pattern"
								placeholder="*, support, or support@domain.com"
								value={pattern}
								onChange={(e) => setPattern(e.target.value)}
							/>
						</div>
					</div>
					<p className="text-xs text-ink-muted">
						Use <span className="font-mono">*</span> for all otherwise unmatched addresses on the selected domain. Adding it enables that domain&apos;s Cloudflare catch-all for Lumimail.
					</p>
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="routing-action">Action</Label>
							<select
								id="routing-action"
								className="w-full h-10 rounded-md border border-border px-3 text-sm"
								value={action}
								onChange={(e) => setAction(e.target.value as "store" | "forward" | "reject")}
							>
								<option value="store">Store in mailbox</option>
								<option value="forward">Forward to address</option>
								<option value="reject">Reject</option>
							</select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="routing-priority">Priority</Label>
							<Input
								id="routing-priority"
								type="number"
								value={priority}
								onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
							/>
						</div>
					</div>

					{action === "store" && (
						<div className="space-y-2">
							<Label htmlFor="routing-mailbox">Target mailbox</Label>
							<select
								id="routing-mailbox"
								className="w-full h-10 rounded-md border border-border px-3 text-sm"
								value={mailboxId}
								onChange={(e) => setMailboxId(e.target.value)}
							>
								<option value="">Select mailbox</option>
								{availableMailboxes.map((m) => (
									<option key={m.id} value={m.id}>
										{m.localPart}@{domainHostname(m.domainId)}
									</option>
								))}
							</select>
						</div>
					)}

					{action === "forward" && (
						<div className="space-y-2">
							<Label htmlFor="routing-forward">Forward to</Label>
							<Input
								id="routing-forward"
								type="email"
								placeholder="destination@example.com"
								value={forwardTo}
								onChange={(e) => setForwardTo(e.target.value)}
							/>
						</div>
					)}

					<Button
						onClick={() => create.mutate()}
						disabled={!canSubmit || create.isPending}
					>
						<Plus className="h-4 w-4 mr-2" />
						{isCatchAllInput ? "Enable catch-all and add rule" : "Add rule"}
					</Button>
					{create.isError && (
						<p className="text-sm text-danger">{create.error instanceof Error ? create.error.message : "Failed to create rule"}</p>
					)}
					{remove.isError && (
						<p className="text-sm text-danger">{remove.error instanceof Error ? remove.error.message : "Failed to remove rule"}</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Active rules</CardTitle>
				</CardHeader>
				<CardContent>
					{(rules.data?.rules ?? []).length === 0 ? (
						<p className="text-sm text-ink-faint">No routing rules yet.</p>
					) : (
						<ul className="divide-y divide-border">
							{sortRoutingRules(rules.data?.rules ?? [])
								.map((r) => (
									<li key={r.id} className="flex items-center justify-between py-3">
										<div className="flex items-center gap-3 text-sm">
											<GitBranch className="h-4 w-4 text-ink-faint" />
											<div>
												<div className="font-medium">
													<span className="font-mono">{r.pattern}</span>
													{" "}on{" "}
													<span className="font-mono">{domainHostname(r.domainId)}</span>
												</div>
												<div className="text-xs text-ink-muted">
													{actionLabel(r)} · priority {r.priority}
												</div>
											</div>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => remove.mutate(r.id)}
											className="text-danger hover:text-danger"
											aria-label={`Remove ${r.pattern} rule for ${domainHostname(r.domainId)}`}
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
