"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ListSection } from "@/components/ui/list-section";
import { domainKeys, mailboxKeys } from "@/lib/query-keys";
import { apiJson } from "@/lib/api/client-response";
import {
	canSubmitRoutingRule,
	filterMailboxesByDomain,
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
	const t = useTranslations("admin");
	const tCommon = useTranslations("common");
	const qc = useQueryClient();
	const [pattern, setPattern] = useState("*");
	const [domainId, setDomainId] = useState("");
	const [action, setAction] = useState<"store" | "forward" | "reject">("store");
	const [mailboxId, setMailboxId] = useState("");
	const [forwardTo, setForwardTo] = useState("");
	const [newDestination, setNewDestination] = useState("");
	const [priority, setPriority] = useState(10);
	const [removeTarget, setRemoveTarget] = useState<RoutingRule | null>(null);

	const domains = useQuery({
		queryKey: domainKeys.list({ includeDns: false }),
		queryFn: () => apiJson.get<{ domains: Domain[] }>("/api/domains"),
	});

	const mailboxes = useQuery({
		queryKey: mailboxKeys.user,
		queryFn: () => apiJson.get<{ mailboxes: Mailbox[] }>("/api/mailboxes"),
	});

	const rules = useQuery({
		queryKey: ["routing-rules"],
		queryFn: () => apiJson.get<{ rules: RoutingRule[] }>("/api/routing-rules"),
	});

	const create = useMutation({
		mutationFn: async () => {
			const body: Record<string, unknown> = { domainId, pattern, action, priority };
			if (action === "store" && mailboxId) body.mailboxId = mailboxId;
			if (action === "forward" && forwardTo) body.forwardTo = forwardTo;
			await apiJson.post("/api/routing-rules", body);
		},
		meta: { suppressErrorToast: true },
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["routing-rules"] });
			setPattern("*");
			setMailboxId("");
			setForwardTo("");
		},
	});

	const remove = useMutation({
		mutationFn: (id: string) => apiJson.delete(`/api/routing-rules/${id}`),
		meta: { suppressErrorToast: true },
		onSuccess: () => qc.invalidateQueries({ queryKey: ["routing-rules"] }),
	});

	// Confirmation must complete before mutate(): a declined confirmation inside
	// mutationFn resolves as success and invalidates caches for a delete that
	// never ran.
	const confirmRemove = (rule: RoutingRule) => {
		if (rule.pattern === "*") {
			setRemoveTarget(rule);
			return;
		}
		remove.mutate(rule.id);
	};

	const destinations = useQuery({
		queryKey: ["forwarding-destinations"],
		queryFn: async () =>
			(await apiJson.get<ForwardingDestination[] | null>("/api/forwarding-destinations")) ?? [],
	});

	const addDestination = useMutation({
		mutationFn: () => apiJson.post("/api/forwarding-destinations", { address: newDestination }),
		meta: { suppressErrorToast: true },
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["forwarding-destinations"] });
			setNewDestination("");
		},
	});

	const refreshDestination = useMutation({
		mutationFn: (id: string) => apiJson.post(`/api/forwarding-destinations/${id}/refresh`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["forwarding-destinations"] }),
	});

	const allDestinations = destinations.data ?? [];
	const verifiedDestinations = allDestinations.filter((d) => d.verified);
	const pendingDestinations = allDestinations.filter((d) => !d.verified);

	const domainHostname = (id: string) =>
		domains.data?.domains.find((d) => d.id === id)?.hostname ?? "";

	const actionLabel = (rule: RoutingRule) => {
		if (rule.action === "store" && rule.mailboxId) return t("actionToMailbox");
		if (rule.action === "forward" && rule.forwardTo) return t("actionForwardTo", { address: rule.forwardTo });
		return rule.action;
	};
	const selectedHostname = domainHostname(domainId);
	const availableMailboxes = filterMailboxesByDomain(mailboxes.data?.mailboxes ?? [], domainId);
	const isCatchAllInput = pattern.trim() === "*" || pattern.trim().toLowerCase() === `*@${selectedHostname.toLowerCase()}`;
	const canSubmit = canSubmitRoutingRule({ domainId, pattern, action, mailboxId, forwardTo });
	const activeRules = rules.data?.rules ?? [];

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("routingTitle")}
				description={t("routingPageDesc")}
			/>

			<ConfirmDialog
				open={removeTarget !== null}
				onOpenChange={(open) => {
					if (!open) setRemoveTarget(null);
				}}
				title={t("removeCatchAllTitle")}
				description={t("removeCatchAllDesc")}
				confirmLabel={t("removeRuleConfirm")}
				cancelLabel={tCommon("cancel")}
				danger
				onConfirm={() => {
					if (removeTarget) remove.mutate(removeTarget.id);
					setRemoveTarget(null);
				}}
			/>

			<Card>
				<CardHeader>
					<CardTitle>{t("addRuleCard")}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<FormField label={t("domain")} htmlFor="routing-domain">
							<Select
								id="routing-domain"
								value={domainId}
								onChange={(e) => { setDomainId(e.target.value); setMailboxId(""); }}
							>
								<option value="">{t("selectDomain")}</option>
								{(domains.data?.domains ?? []).map((d) => (
									<option key={d.id} value={d.id}>{d.hostname}</option>
								))}
							</Select>
						</FormField>
						<FormField label={t("pattern")} htmlFor="routing-pattern">
							<Input
								id="routing-pattern"
								placeholder={t("patternPlaceholder")}
								value={pattern}
								onChange={(e) => setPattern(e.target.value)}
							/>
						</FormField>
					</div>
					<p className="text-xs text-ink-muted">
						{t.rich("catchAllHint", {
							mono: (chunks) => <span className="font-mono">{chunks}</span>,
						})}
					</p>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<FormField label={t("action")} htmlFor="routing-action">
							<Select
								id="routing-action"
								value={action}
								onChange={(e) => setAction(e.target.value as "store" | "forward" | "reject")}
							>
								<option value="store">{t("actionStore")}</option>
								<option value="forward">{t("actionForward")}</option>
								<option value="reject">{t("actionReject")}</option>
							</Select>
						</FormField>
						<FormField label={t("priority")} htmlFor="routing-priority">
							<Input
								id="routing-priority"
								type="number"
								value={priority}
								onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
							/>
						</FormField>
					</div>

					{action === "store" && (
						<FormField label={t("targetMailbox")} htmlFor="routing-mailbox">
							<Select
								id="routing-mailbox"
								value={mailboxId}
								onChange={(e) => setMailboxId(e.target.value)}
							>
								<option value="">{t("selectMailbox")}</option>
								{availableMailboxes.map((m) => (
									<option key={m.id} value={m.id}>
										{m.localPart}@{domainHostname(m.domainId)}
									</option>
								))}
							</Select>
						</FormField>
					)}

					{action === "forward" && (
						<FormField label={t("forwardTo")} htmlFor="routing-forward">
							{verifiedDestinations.length > 0 ? (
								<Select
									id="routing-forward"
									value={forwardTo}
									onChange={(e) => setForwardTo(e.target.value)}
								>
									<option value="">{t("selectVerifiedDestination")}</option>
									{verifiedDestinations.map((destination) => (
										<option key={destination.id} value={destination.address}>
											{destination.address}
										</option>
									))}
								</Select>
							) : (
								<p className="text-sm text-ink-muted">
									{t("verifyDestinationFirst")}
								</p>
							)}
							{pendingDestinations.length > 0 && (
								<p className="text-sm text-ink-muted">
									{t("awaitingVerification", { addresses: pendingDestinations.map((d) => d.address).join(", ") })}
								</p>
							)}
						</FormField>
					)}

					<Button
						onClick={() => create.mutate()}
						disabled={!canSubmit || create.isPending}
					>
						<Plus className="h-4 w-4 mr-2" />
						{isCatchAllInput ? t("enableCatchAllAndAdd") : t("addRuleCard")}
					</Button>
					{create.isError && (
						<p className="text-sm text-danger">{create.error instanceof Error ? create.error.message : t("createRuleFailed")}</p>
					)}
					{remove.isError && (
						<p className="text-sm text-danger">{remove.error instanceof Error ? remove.error.message : t("removeRuleFailed")}</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("forwardingDestinations")}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="text-sm text-ink-muted">
						{t("destinationVerificationInfo")}
					</p>
					<div className="flex gap-2">
						<Input
							id="new-forwarding-destination"
							type="email"
							placeholder={t("destinationPlaceholder")}
							value={newDestination}
							onChange={(e) => setNewDestination(e.target.value)}
						/>
						<Button
							onClick={() => addDestination.mutate()}
							disabled={!newDestination.trim() || addDestination.isPending}
						>
							<Plus className="h-4 w-4 mr-2" />
							{tCommon("add")}
						</Button>
					</div>
					{addDestination.isError && (
						<p className="text-sm text-danger">
							{addDestination.error instanceof Error ? addDestination.error.message : t("addDestinationFailed")}
						</p>
					)}
					{allDestinations.length === 0 && (
						<p className="text-sm text-ink-muted">{t("noDestinations")}</p>
					)}
					<ul className="divide-y divide-border">
						{allDestinations.map((destination) => (
							<li key={destination.id} className="flex items-center justify-between py-2">
								<span className="text-sm text-ink">{destination.address}</span>
								<span className="flex items-center gap-3">
									<span className={`text-xs ${destination.verified ? "text-success" : "text-ink-muted"}`}>
										{destination.verified ? t("verified") : t("pendingVerification")}
									</span>
									{!destination.verified && (
										<Button
											variant="outline"
											onClick={() => refreshDestination.mutate(destination.id)}
											disabled={refreshDestination.isPending}
										>
											{t("checkAgain")}
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
					<CardTitle>{t("activeRules")}</CardTitle>
				</CardHeader>
				<CardContent>
					<ListSection
						loading={rules.isLoading}
						loadingLabel={t("loadingRoutingRules")}
						empty={activeRules.length === 0}
						emptyLabel={t("noRoutingRules")}
						emptyIcon={GitBranch}
					>
						<ul className="divide-y divide-border">
							{sortRoutingRules(activeRules)
								.map((r) => (
									<li key={r.id} className="flex items-center justify-between py-3">
										<div className="flex items-center gap-3 text-sm">
											<GitBranch className="h-4 w-4 text-ink-faint" />
											<div>
												<div className="font-medium">
													{t.rich("ruleSummary", {
														pattern: r.pattern,
														domain: domainHostname(r.domainId),
														mono: (chunks) => <span className="font-mono">{chunks}</span>,
													})}
												</div>
												<div className="text-xs text-ink-muted">
													{actionLabel(r)} · {t("priorityLabel", { priority: r.priority })}
												</div>
											</div>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => confirmRemove(r)}
											className="text-danger hover:text-danger"
											aria-label={t("removeRuleAria", { pattern: r.pattern, hostname: domainHostname(r.domainId) })}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</li>
								))}
						</ul>
					</ListSection>
				</CardContent>
			</Card>
		</div>
	);
}
