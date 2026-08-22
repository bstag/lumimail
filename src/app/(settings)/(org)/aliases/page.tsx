"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus, Trash2, ArrowRight, Users, AtSign } from "lucide-react";
import { apiJson } from "@/lib/api/client-response";
import { domainKeys, mailboxKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ListSection } from "@/components/ui/list-section";
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

/** Alias queries are page-local; register in query-keys.ts if a second file needs them. */
const aliasKeys = {
	all: ["aliases"] as const,
};

async function fetchAliases(): Promise<AliasRow[]> {
	return (await apiJson.get<{ aliases: AliasRow[] }>("/api/aliases")).aliases ?? [];
}

function errorText(error: unknown, fallback: string): string | null {
	if (!error) return null;
	return error instanceof Error ? error.message : fallback;
}

function firstError(errors: Array<string | null>) {
	return errors.find((error) => error !== null) ?? null;
}

function anyLoading(states: boolean[]) {
	return states.some(Boolean);
}

function AliasError({ error }: { error: string | null }) {
	return error ? <p className="text-sm text-danger">{error}</p> : null;
}

function formatMailboxAddress(mailboxes: Mailbox[], id: string | null, missing: string) {
	const mailbox = mailboxes.find((candidate) => candidate.id === id);
	return mailbox ? `${mailbox.localPart}@${mailbox.hostname}` : missing;
}

function ActiveAliasesCard({ aliases, mailboxes, groupEdits, savePending, saveVariables, mailboxAddress, onRemove, onGroupChange, onGroupSave }: {
	aliases: AliasRow[]; mailboxes: Mailbox[]; groupEdits: Record<string, string[]>; savePending: boolean; saveVariables?: string;
	mailboxAddress: (id: string | null) => string; onRemove: (alias: AliasRow) => void;
	onGroupChange: (aliasId: string, mailboxId: string, checked: boolean) => void; onGroupSave: (aliasId: string) => void;
}) {
	const t = useTranslations("admin");
	return <Card><CardHeader><CardTitle>{t("activeAliases")}</CardTitle></CardHeader><CardContent><ListSection loading={false} loadingLabel={t("loadingAliases")} empty={aliases.length === 0} emptyLabel={t("noAliases")} emptyIcon={AtSign}><ul className="divide-y divide-border">{aliases.map((alias) => <li key={alias.id} className="space-y-3 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm"><span className="font-mono font-medium">{alias.localPart}@{alias.domainHostname}</span><ArrowRight className="h-3 w-3 text-ink-faint" /><span className="text-ink-muted">{alias.isGroup ? t("mailboxGroupCount", { count: alias.members.length }) : alias.forwardTo ? t("legacyForwardingUnavailable") : mailboxAddress(alias.targetMailboxId)}</span></div><Button variant="ghost" size="sm" onClick={() => onRemove(alias)} className="text-danger hover:text-danger" aria-label={t("deleteAliasAria", { address: `${alias.localPart}@${alias.domainHostname}` })}><Trash2 className="h-4 w-4" /></Button></div>{alias.isGroup && <div className="rounded-md border border-border p-3 space-y-3"><div className="flex items-center gap-2 text-sm font-medium text-ink"><Users className="h-4 w-4" />{t("groupMembers")}</div><MailboxChecklist mailboxes={mailboxes} selected={groupEdits[alias.id] ?? []} onChange={(mailboxId, checked) => onGroupChange(alias.id, mailboxId, checked)} label={t("groupMembersFor", { address: `${alias.localPart}@${alias.domainHostname}` })} /><Button size="sm" onClick={() => onGroupSave(alias.id)} disabled={(savePending && saveVariables === alias.id) || (groupEdits[alias.id]?.length ?? 0) < 2}>{t("saveMembers")}</Button></div>}</li>)}</ul></ListSection></CardContent></Card>;
}

function CreateAliasCard({ kind, domainId, localPart, targetMailboxId, groupMailboxIds, domains, mailboxes, pending, mailboxAddress, onKind, onDomain, onLocalPart, onTarget, onGroupChange, onCreate }: {
	kind: AliasKind; domainId: string; localPart: string; targetMailboxId: string; groupMailboxIds: string[]; domains: Domain[]; mailboxes: Mailbox[]; pending: boolean;
	mailboxAddress: (id: string | null) => string; onKind: (kind: AliasKind) => void; onDomain: (id: string) => void; onLocalPart: (value: string) => void; onTarget: (id: string) => void; onGroupChange: (id: string, checked: boolean) => void; onCreate: () => void;
}) {
	const t = useTranslations("admin");
	const missingTarget = kind === "mailbox" ? !targetMailboxId : groupMailboxIds.length < 2;
	return <Card><CardHeader><CardTitle>{t("createAliasTitle")}</CardTitle></CardHeader><CardContent className="space-y-4"><FormField label={t("aliasType")} htmlFor="alias-type"><Select id="alias-type" value={kind} onChange={(event) => onKind(event.target.value as AliasKind)}><option value="mailbox">{t("aliasKindMailbox")}</option><option value="group">{t("aliasKindGroup")}</option></Select></FormField><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FormField label={t("localPart")} htmlFor="alias-local-part"><Input id="alias-local-part" placeholder={t("usernamePlaceholder")} value={localPart} onChange={(event) => onLocalPart(event.target.value)} /></FormField><FormField label={t("domain")} htmlFor="alias-domain"><Select id="alias-domain" value={domainId} onChange={(event) => onDomain(event.target.value)}><option value="">{t("selectDomain")}</option>{domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.hostname}</option>)}</Select></FormField></div>{kind === "mailbox" ? <FormField label={t("deliverToMailbox")} htmlFor="alias-target"><Select id="alias-target" value={targetMailboxId} onChange={(event) => onTarget(event.target.value)}><option value="">{t("selectMailbox")}</option>{mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailboxAddress(mailbox.id)}{mailbox.displayName ? ` (${mailbox.displayName})` : ""}</option>)}</Select></FormField> : <MailboxChecklist mailboxes={mailboxes} selected={groupMailboxIds} onChange={onGroupChange} />}<p className="text-xs text-ink-faint">{t("externalForwardingNote")}</p><Button onClick={onCreate} disabled={pending || !domainId || !localPart || missingTarget}><Plus className="h-4 w-4 mr-2" />{kind === "group" ? t("createGroup") : t("createAliasTitle")}</Button></CardContent></Card>;
}

function AliasDeleteDialog({ target, onClose, onConfirm }: { target: AliasRow | null; onClose: () => void; onConfirm: (id: string) => void }) {
	const t = useTranslations("admin"); const tCommon = useTranslations("common");
	const address = target ? `${target.localPart}@${target.domainHostname}` : "";
	return <ConfirmDialog open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }} title={t("deleteAliasTitle")} description={target ? t("deleteAliasDesc", { address }) : ""} confirmLabel={t("deleteAliasConfirm")} cancelLabel={tCommon("cancel")} danger onConfirm={() => { if (target) onConfirm(target.id); onClose(); }} />;
}

function AliasesPageContent({ initialKind, initialDomainId, initialTargetMailboxId }: {
	initialKind: AliasKind; initialDomainId: string; initialTargetMailboxId: string;
}) {
	const t = useTranslations("admin");
	const qc = useQueryClient();

	const [domainId, setDomainId] = useState(initialDomainId);
	const [localPart, setLocalPart] = useState("");
	const [kind, setKind] = useState<AliasKind>(initialKind);
	const [targetMailboxId, setTargetMailboxId] = useState(initialTargetMailboxId);
	const [groupMailboxIds, setGroupMailboxIds] = useState<string[]>([]);
	const [groupEdits, setGroupEdits] = useState<Record<string, string[]>>({});
	const [localError, setLocalError] = useState<string | null>(null);
	const [removeTarget, setRemoveTarget] = useState<AliasRow | null>(null);

	const aliasesQuery = useQuery({
		queryKey: aliasKeys.all,
		queryFn: fetchAliases,
	});

	const domainsQuery = useQuery({
		queryKey: domainKeys.list({ includeDns: false }),
		queryFn: () => apiJson.get<{ domains: Domain[] }>("/api/domains"),
	});

	const mailboxesQuery = useQuery({
		queryKey: mailboxKeys.admin,
		queryFn: () => apiJson.get<{ mailboxes: Mailbox[] }>("/api/admin/mailboxes"),
	});

	const aliases = aliasesQuery.data ?? [];
	const domains = domainsQuery.data?.domains ?? [];
	const mailboxes = mailboxesQuery.data?.mailboxes ?? [];

	// Group membership edits start from the fetched state and stay local until saved.
	useEffect(() => {
		if (!aliasesQuery.data) return;
		setGroupEdits(Object.fromEntries(
			aliasesQuery.data
				.filter((alias) => alias.isGroup)
				.map((alias) => [alias.id, alias.members.map((member) => member.mailboxId)]),
		));
	}, [aliasesQuery.data]);

	const create = useMutation({
		mutationFn: async () => {
			const body = kind === "mailbox"
				? { kind, domainId, localPart, targetMailboxId }
				: { kind, domainId, localPart, mailboxIds: groupMailboxIds };
			await apiJson.post("/api/aliases", body);
		},
		meta: { suppressErrorToast: true },
		onMutate: () => setLocalError(null),
		onSuccess: () => {
			setLocalPart("");
			setTargetMailboxId("");
			setGroupMailboxIds([]);
			qc.invalidateQueries({ queryKey: aliasKeys.all });
		},
	});

	const saveGroup = useMutation({
		mutationFn: async (aliasId: string) => {
			await apiJson.patch(`/api/aliases/${aliasId}`, { mailboxIds: groupEdits[aliasId] ?? [] });
		},
		meta: { suppressErrorToast: true },
		onMutate: () => setLocalError(null),
		onSuccess: () => qc.invalidateQueries({ queryKey: aliasKeys.all }),
	});

	const removeAlias = useMutation({
		mutationFn: (id: string) => apiJson.delete(`/api/aliases/${id}`),
		meta: { suppressErrorToast: true },
		onMutate: () => setLocalError(null),
		onSuccess: () => qc.invalidateQueries({ queryKey: aliasKeys.all }),
	});

	function requestGroupSave(aliasId: string) {
		if ((groupEdits[aliasId] ?? []).length < 2) {
			setLocalError(t("groupMinimum"));
			return;
		}
		saveGroup.mutate(aliasId);
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

	const mailboxAddress = (id: string | null) => formatMailboxAddress(mailboxes, id, t("missingMailbox"));

	const error = firstError([
		localError,
		errorText(aliasesQuery.error, t("loadAliasesFailed")),
		errorText(domainsQuery.error, t("loadAliasesFailed")),
		errorText(mailboxesQuery.error, t("loadAliasesFailed")),
		errorText(create.error, t("createAliasFailed")),
		errorText(saveGroup.error, t("updateGroupFailed")),
		errorText(removeAlias.error, t("deleteAliasFailed")),
	]);

	if (anyLoading([aliasesQuery.isLoading, domainsQuery.isLoading, mailboxesQuery.isLoading])) {
		return <div className="text-sm text-ink-muted">{t("loadingShort")}</div>;
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("aliasesTitle")}
				description={t("aliasesPageDesc")}
			/>

			<AliasError error={error} />

			<AliasDeleteDialog target={removeTarget} onClose={() => setRemoveTarget(null)} onConfirm={(id) => removeAlias.mutate(id)} />

			<CreateAliasCard kind={kind} domainId={domainId} localPart={localPart} targetMailboxId={targetMailboxId} groupMailboxIds={groupMailboxIds} domains={domains} mailboxes={mailboxes} pending={create.isPending} mailboxAddress={mailboxAddress} onKind={setKind} onDomain={setDomainId} onLocalPart={setLocalPart} onTarget={setTargetMailboxId} onGroupChange={(id, checked) => setGroupMailboxIds((current) => toggleMailbox(current, id, checked))} onCreate={() => create.mutate()} />

			<ActiveAliasesCard aliases={aliases} mailboxes={mailboxes} groupEdits={groupEdits} savePending={saveGroup.isPending} saveVariables={saveGroup.variables} mailboxAddress={mailboxAddress} onRemove={setRemoveTarget} onGroupSave={requestGroupSave} onGroupChange={(aliasId, mailboxId, checked) => setGroupEdits((current) => ({ ...current, [aliasId]: toggleMailbox(current[aliasId] ?? [], mailboxId, checked) }))} />
		</div>
	);
}

export default function AliasesPage(props: { initialKind?: AliasKind; initialDomainId?: string; initialTargetMailboxId?: string } = {}) {
	return <AliasesPageContent initialKind={props.initialKind ?? "mailbox"} initialDomainId={props.initialDomainId ?? ""} initialTargetMailboxId={props.initialTargetMailboxId ?? ""} />;
}

function MailboxChecklist({
	mailboxes,
	selected,
	onChange,
	label,
}: {
	mailboxes: Mailbox[];
	selected: string[];
	onChange: (mailboxId: string, checked: boolean) => void;
	label?: string;
}) {
	const t = useTranslations("admin");
	return (
		<fieldset className="space-y-2 rounded-md border border-border p-3">
			<legend className="px-1 text-sm font-medium text-ink">{label ?? t("groupMailboxes")}</legend>
			{mailboxes.length === 0 ? (
				<p className="text-sm text-ink-faint">{t("noOrgMailboxes")}</p>
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
