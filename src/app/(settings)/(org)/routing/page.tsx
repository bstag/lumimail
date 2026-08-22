"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
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

function findDomainHostname(domains: Domain[], id: string): string {
	return domains.find((domain) => domain.id === id)?.hostname ?? "";
}

function MonospaceText(chunks: ReactNode) {
	return <span className="font-mono">{chunks}</span>;
}

function routingRuleBody(domainId: string, pattern: string, action: RoutingRule["action"], priority: number, mailboxId: string, forwardTo: string) {
	return { domainId, pattern, action, priority, ...(action === "store" && mailboxId ? { mailboxId } : {}), ...(action === "forward" && forwardTo ? { forwardTo } : {}) };
}

function isCatchAll(pattern: string, hostname: string) {
	const normalized = pattern.trim().toLowerCase();
	return normalized === "*" || normalized === `*@${hostname.toLowerCase()}`;
}

function removeRoutingRule(rule: RoutingRule, confirm: (rule: RoutingRule) => void, remove: (id: string) => void) {
	if (rule.pattern === "*") return confirm(rule);
	remove(rule.id);
}

function DestinationsCard({ destinations, value, adding, refreshing, error, onChange, onAdd, onRefresh }: {
	destinations: ForwardingDestination[]; value: string; adding: boolean; refreshing: boolean; error: unknown;
	onChange: (value: string) => void; onAdd: () => void; onRefresh: (id: string) => void;
}) {
	const t = useTranslations("admin"); const tCommon = useTranslations("common");
	return <Card><CardHeader><CardTitle>{t("forwardingDestinations")}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-ink-muted">{t("destinationVerificationInfo")}</p><div className="flex gap-2"><Input id="new-forwarding-destination" type="email" placeholder={t("destinationPlaceholder")} value={value} onChange={(event) => onChange(event.target.value)} /><Button onClick={onAdd} disabled={!value.trim() || adding}><Plus className="h-4 w-4 mr-2" />{tCommon("add")}</Button></div>{error ? <p className="text-sm text-danger">{error instanceof Error ? error.message : t("addDestinationFailed")}</p> : null}{destinations.length === 0 && <p className="text-sm text-ink-muted">{t("noDestinations")}</p>}<ul className="divide-y divide-border">{destinations.map((destination) => <li key={destination.id} className="flex items-center justify-between py-2"><span className="text-sm text-ink">{destination.address}</span><span className="flex items-center gap-3"><span className={`text-xs ${destination.verified ? "text-success" : "text-ink-muted"}`}>{destination.verified ? t("verified") : t("pendingVerification")}</span>{!destination.verified && <Button variant="outline" onClick={() => onRefresh(destination.id)} disabled={refreshing}>{t("checkAgain")}</Button>}</span></li>)}</ul></CardContent></Card>;
}

function ActiveRulesCard({ rules, loading, domains, onRemove }: { rules: RoutingRule[]; loading: boolean; domains: Domain[]; onRemove: (rule: RoutingRule) => void }) {
	const t = useTranslations("admin");
	const actionLabel = (rule: RoutingRule) => rule.action === "store" && rule.mailboxId ? t("actionToMailbox") : rule.action === "forward" && rule.forwardTo ? t("actionForwardTo", { address: rule.forwardTo }) : rule.action;
	return <Card><CardHeader><CardTitle>{t("activeRules")}</CardTitle></CardHeader><CardContent><ListSection loading={loading} loadingLabel={t("loadingRoutingRules")} empty={rules.length === 0} emptyLabel={t("noRoutingRules")} emptyIcon={GitBranch}><ul className="divide-y divide-border">{sortRoutingRules(rules).map((rule) => <li key={rule.id} className="flex items-center justify-between py-3"><div className="flex items-center gap-3 text-sm"><GitBranch className="h-4 w-4 text-ink-faint" /><div><div className="font-medium">{t.rich("ruleSummary", { pattern: rule.pattern, domain: findDomainHostname(domains, rule.domainId), mono: MonospaceText })}</div><div className="text-xs text-ink-muted">{actionLabel(rule)} · {t("priorityLabel", { priority: rule.priority })}</div></div></div><Button variant="ghost" size="sm" onClick={() => onRemove(rule)} className="text-danger hover:text-danger" aria-label={t("removeRuleAria", { pattern: rule.pattern, hostname: findDomainHostname(domains, rule.domainId) })}><Trash2 className="h-4 w-4" /></Button></li>)}</ul></ListSection></CardContent></Card>;
}

function RuleMutationErrors({ createError, removeError }: { createError: unknown; removeError: unknown }) {
	const t = useTranslations("admin");
	return <>{createError ? <p className="text-sm text-danger">{createError instanceof Error ? createError.message : t("createRuleFailed")}</p> : null}{removeError ? <p className="text-sm text-danger">{removeError instanceof Error ? removeError.message : t("removeRuleFailed")}</p> : null}</>;
}

function AddRuleCard({ domains, domainId, pattern, action, priority, mailboxId, forwardTo, mailboxes, verified, pending, catchAll, canSubmit, creating, createError, removeError, onDomain, onPattern, onAction, onPriority, onMailbox, onForward, onCreate }: {
	domains: Domain[]; domainId: string; pattern: string; action: RoutingRule["action"]; priority: number; mailboxId: string; forwardTo: string; mailboxes: Mailbox[]; verified: ForwardingDestination[]; pending: ForwardingDestination[]; catchAll: boolean; canSubmit: boolean; creating: boolean; createError: unknown; removeError: unknown;
	onDomain: (id: string) => void; onPattern: (value: string) => void; onAction: (action: RoutingRule["action"]) => void; onPriority: (value: number) => void; onMailbox: (id: string) => void; onForward: (address: string) => void; onCreate: () => void;
}) {
	const t = useTranslations("admin");
	return <Card><CardHeader><CardTitle>{t("addRuleCard")}</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FormField label={t("domain")} htmlFor="routing-domain"><Select id="routing-domain" value={domainId} onChange={(event) => onDomain(event.target.value)}><option value="">{t("selectDomain")}</option>{domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.hostname}</option>)}</Select></FormField><FormField label={t("pattern")} htmlFor="routing-pattern"><Input id="routing-pattern" placeholder={t("patternPlaceholder")} value={pattern} onChange={(event) => onPattern(event.target.value)} /></FormField></div><p className="text-xs text-ink-muted">{t.rich("catchAllHint", { mono: MonospaceText })}</p><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FormField label={t("action")} htmlFor="routing-action"><Select id="routing-action" value={action} onChange={(event) => onAction(event.target.value as RoutingRule["action"])}><option value="store">{t("actionStore")}</option><option value="forward">{t("actionForward")}</option><option value="reject">{t("actionReject")}</option></Select></FormField><FormField label={t("priority")} htmlFor="routing-priority"><Input id="routing-priority" type="number" value={priority} onChange={(event) => onPriority(parseInt(event.target.value) || 0)} /></FormField></div>{action === "store" && <FormField label={t("targetMailbox")} htmlFor="routing-mailbox"><Select id="routing-mailbox" value={mailboxId} onChange={(event) => onMailbox(event.target.value)}><option value="">{t("selectMailbox")}</option>{mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.localPart}@{findDomainHostname(domains, mailbox.domainId)}</option>)}</Select></FormField>}{action === "forward" && <FormField label={t("forwardTo")} htmlFor="routing-forward">{verified.length > 0 ? <Select id="routing-forward" value={forwardTo} onChange={(event) => onForward(event.target.value)}><option value="">{t("selectVerifiedDestination")}</option>{verified.map((destination) => <option key={destination.id} value={destination.address}>{destination.address}</option>)}</Select> : <p className="text-sm text-ink-muted">{t("verifyDestinationFirst")}</p>}{pending.length > 0 && <p className="text-sm text-ink-muted">{t("awaitingVerification", { addresses: pending.map((destination) => destination.address).join(", ") })}</p>}</FormField>}<Button onClick={onCreate} disabled={!canSubmit || creating}><Plus className="h-4 w-4 mr-2" />{catchAll ? t("enableCatchAllAndAdd") : t("addRuleCard")}</Button><RuleMutationErrors createError={createError} removeError={removeError} /></CardContent></Card>;
}

function RoutingPageContent({ initialAction, initialDomainId, initialMailboxId, initialForwardTo }: {
	initialAction: "store" | "forward" | "reject"; initialDomainId: string; initialMailboxId: string; initialForwardTo: string;
}) {
	const t = useTranslations("admin");
	const tCommon = useTranslations("common");
	const qc = useQueryClient();
	const [pattern, setPattern] = useState("*");
	const [domainId, setDomainId] = useState(initialDomainId);
	const [action, setAction] = useState<"store" | "forward" | "reject">(initialAction);
	const [mailboxId, setMailboxId] = useState(initialMailboxId);
	const [forwardTo, setForwardTo] = useState(initialForwardTo);
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
			await apiJson.post("/api/routing-rules", routingRuleBody(domainId, pattern, action, priority, mailboxId, forwardTo));
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
	function handleRemoveRule(rule: RoutingRule) {
		removeRoutingRule(rule, setRemoveTarget, (id) => remove.mutate(id));
	}

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

	const domainRows = domains.data?.domains ?? [];
	const selectedHostname = findDomainHostname(domainRows, domainId);
	const availableMailboxes = filterMailboxesByDomain(mailboxes.data?.mailboxes ?? [], domainId);
	const isCatchAllInput = isCatchAll(pattern, selectedHostname);
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

			<AddRuleCard domains={domainRows} domainId={domainId} pattern={pattern} action={action} priority={priority} mailboxId={mailboxId} forwardTo={forwardTo} mailboxes={availableMailboxes} verified={verifiedDestinations} pending={pendingDestinations} catchAll={isCatchAllInput} canSubmit={canSubmit} creating={create.isPending} createError={create.error} removeError={remove.error} onDomain={(id) => { setDomainId(id); setMailboxId(""); }} onPattern={setPattern} onAction={setAction} onPriority={setPriority} onMailbox={setMailboxId} onForward={setForwardTo} onCreate={() => create.mutate()} />


			<DestinationsCard destinations={allDestinations} value={newDestination} adding={addDestination.isPending} refreshing={refreshDestination.isPending} error={addDestination.error} onChange={setNewDestination} onAdd={() => addDestination.mutate()} onRefresh={(id) => refreshDestination.mutate(id)} />
			<ActiveRulesCard rules={activeRules} loading={rules.isLoading} domains={domainRows} onRemove={handleRemoveRule} />
		</div>
	);
}

export default function RoutingPage(props: { initialAction?: "store" | "forward" | "reject"; initialDomainId?: string; initialMailboxId?: string; initialForwardTo?: string } = {}) {
	return <RoutingPageContent initialAction={props.initialAction ?? "store"} initialDomainId={props.initialDomainId ?? ""} initialMailboxId={props.initialMailboxId ?? ""} initialForwardTo={props.initialForwardTo ?? ""} />;
}
