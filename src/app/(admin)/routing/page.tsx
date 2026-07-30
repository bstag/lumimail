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
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";

type RoutingRule = {
	id: string;
	pattern: string;
	action: "store" | "forward" | "reject";
	mailboxId: string | null;
	forwardTo: string | null;
	priority: number;
	domainId: string;
};

type ForwardingDestination = { id: string; address: string; verified: boolean };
type Domain = { id: string; hostname: string };
type Mailbox = { id: string; localPart: string; domainId: string; displayName: string | null };

export default function RoutingPage() {
	const qc = useQueryClient();
	const [pattern, setPattern] = useState("*");
	const [domainId, setDomainId] = useState("");
	const [action, setAction] = useState<"store" | "forward" | "reject">("store");
	const [mailboxId, setMailboxId] = useState("");
	const [forwardTo, setForwardTo] = useState("");
	const [newDestination, setNewDestination] = useState("");
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
		queryFn: async () => readRoutingResponse<{ rules: RoutingRule[] }>(
			await authFetch("/api/routing-rules"),
		),
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
			const res = await authFetch(`/api/routing-rules/${id}`, { method: "DELETE" });
			await readRoutingResponse(res);
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["routing-rules"] }),
	});

	// Confirmation must happen before mutate(): a declined confirm inside
	// mutationFn resolves as success and invalidates caches for a delete that
	// never ran.
	const confirmRemove = (rule: RoutingRule) => {
		if (rule.pattern === "*" && !confirm("Remove this catch-all and disable unmatched delivery for this domain?")) return;
		remove.mutate(rule.id);
	};

	const destinations = useQuery({
		queryKey: ["forwarding-destinations"],
		queryFn: async () => {
			const res = await authFetch("/api/forwarding-destinations");
			const json = (await res.json()) as { success: boolean; data?: ForwardingDestination[] };
			return json.data ?? [];
		},
	});

	const addDestination = useMutation({
		mutationFn: async () => {
			const res = await authFetch("/api/forwarding-destinations", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ address: newDestination }),
			});
			await readRoutingResponse(res);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["forwarding-destinations"] });
			setNewDestination("");
		},
	});

	const refreshDestination = useMutation({
		mutationFn: async (id: string) => {
			const res = await authFetch(`/api/forwarding-destinations/${id}/refresh`, { method: "POST" });
			await readRoutingResponse(res);
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["forwarding-destinations"] }),
	});

	const allDestinations = destinations.data ?? [];
	const verifiedDestinations = allDestinations.filter((d) => d.verified);
	const pendingDestinations = allDestinations.filter((d) => !d.verified);

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
		<div className="space-y-6">
			<PageHeader
				title="Routing rules"
				description="Named addresses are matched before real mailboxes; catch-all runs only for otherwise unmatched addresses. Priority applies within each match type."
			/>

			<Card>
				<CardHeader>
					<CardTitle>Add rule</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="routing-domain">Domain</Label>
							<Select
								id="routing-domain"
								value={domainId}
								onChange={(e) => { setDomainId(e.target.value); setMailboxId(""); }}
							>
								<option value="">Select domain</option>
								{(domains.data?.domains ?? []).map((d) => (
									<option key={d.id} value={d.id}>{d.hostname}</option>
								))}
							</Select>
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
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="routing-action">Action</Label>
							<Select
								id="routing-action"
								value={action}
								onChange={(e) => setAction(e.target.value as "store" | "forward" | "reject")}
							>
								<option value="store">Store in mailbox</option>
								<option value="forward">Forward to address</option>
								<option value="reject">Reject</option>
							</Select>
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
							<Select
								id="routing-mailbox"
								value={mailboxId}
								onChange={(e) => setMailboxId(e.target.value)}
							>
								<option value="">Select mailbox</option>
								{availableMailboxes.map((m) => (
									<option key={m.id} value={m.id}>
										{m.localPart}@{domainHostname(m.domainId)}
									</option>
								))}
							</Select>
						</div>
					)}

					{action === "forward" && (
						<div className="space-y-2">
							<Label htmlFor="routing-forward">Forward to</Label>
							{verifiedDestinations.length > 0 ? (
								<Select
									id="routing-forward"
									value={forwardTo}
									onChange={(e) => setForwardTo(e.target.value)}
								>
									<option value="">Select a verified destination</option>
									{verifiedDestinations.map((destination) => (
										<option key={destination.id} value={destination.address}>
											{destination.address}
										</option>
									))}
								</Select>
							) : (
								<p className="text-sm text-ink-muted">
									Add and verify a destination below before forwarding. Mail cannot be
									forwarded to an unverified address.
								</p>
							)}
							{pendingDestinations.length > 0 && (
								<p className="text-sm text-ink-muted">
									Awaiting verification: {pendingDestinations.map((d) => d.address).join(", ")}
								</p>
							)}
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
					<CardTitle>Forwarding destinations</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-sm text-ink-muted">
						Cloudflare emails each destination a verification link. Until the recipient
						confirms it, mail cannot be forwarded there and rules using it are refused.
					</p>
					<div className="flex gap-2">
						<Input
							id="new-forwarding-destination"
							type="email"
							placeholder="destination@example.com"
							value={newDestination}
							onChange={(e) => setNewDestination(e.target.value)}
						/>
						<Button
							onClick={() => addDestination.mutate()}
							disabled={!newDestination.trim() || addDestination.isPending}
						>
							<Plus className="h-4 w-4 mr-2" />
							Add
						</Button>
					</div>
					{addDestination.isError && (
						<p className="text-sm text-danger">
							{addDestination.error instanceof Error ? addDestination.error.message : "Failed to add destination"}
						</p>
					)}
					{allDestinations.length === 0 && (
						<p className="text-sm text-ink-muted">No forwarding destinations yet.</p>
					)}
					<ul className="divide-y divide-border">
						{allDestinations.map((destination) => (
							<li key={destination.id} className="flex items-center justify-between py-2">
								<span className="text-sm text-ink">{destination.address}</span>
								<span className="flex items-center gap-3">
									<span className={`text-xs ${destination.verified ? "text-success" : "text-ink-muted"}`}>
										{destination.verified ? "Verified" : "Pending verification"}
									</span>
									{!destination.verified && (
										<Button
											variant="outline"
											onClick={() => refreshDestination.mutate(destination.id)}
											disabled={refreshDestination.isPending}
										>
											Check again
										</Button>
									)}
								</span>
							</li>
						))}
					</ul>
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
											onClick={() => confirmRemove(r)}
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
