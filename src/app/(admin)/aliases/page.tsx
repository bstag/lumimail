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

function errorText(error: unknown, fallback: string): string | null {
	if (!error) return null;
	return error instanceof Error ? error.message : fallback;
}

export default function AliasesPage() {
	const t = useTranslations("admin");
	const tCommon = useTranslations("common");
	const qc = useQueryClient();

	const [domainId, setDomainId] = useState("");
	const [localPart, setLocalPart] = useState("");
	const [kind, setKind] = useState<AliasKind>("mailbox");
	const [targetMailboxId, setTargetMailboxId] = useState("");
	const [groupMailboxIds, setGroupMailboxIds] = useState<string[]>([]);
	const [groupEdits, setGroupEdits] = useState<Record<string, string[]>>({});
	const [localError, setLocalError] = useState<string | null>(null);
	const [removeTarget, setRemoveTarget] = useState<AliasRow | null>(null);

	const aliasesQuery = useQuery({
		queryKey: aliasKeys.all,
		queryFn: async () =>
			(await apiJson.get<{ aliases: AliasRow[] }>("/api/aliases")).aliases ?? [],
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

	const mailboxAddress = (id: string | null) => {
		const mailbox = mailboxes.find((candidate) => candidate.id === id);
		return mailbox ? `${mailbox.localPart}@${mailbox.hostname}` : t("missingMailbox");
	};

	const error =
		localError ??
		errorText(aliasesQuery.error, t("loadAliasesFailed")) ??
		errorText(domainsQuery.error, t("loadAliasesFailed")) ??
		errorText(mailboxesQuery.error, t("loadAliasesFailed")) ??
		errorText(create.error, t("createAliasFailed")) ??
		errorText(saveGroup.error, t("updateGroupFailed")) ??
		errorText(removeAlias.error, t("deleteAliasFailed"));

	if (aliasesQuery.isLoading || domainsQuery.isLoading || mailboxesQuery.isLoading) {
		return <div className="text-sm text-ink-muted">{t("loadingShort")}</div>;
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("aliasesTitle")}
				description={t("aliasesPageDesc")}
			/>

			{error && <p className="text-sm text-danger">{error}</p>}

			<ConfirmDialog
				open={removeTarget !== null}
				onOpenChange={(open) => {
					if (!open) setRemoveTarget(null);
				}}
				title={t("deleteAliasTitle")}
				description={
					removeTarget
						? t("deleteAliasDesc", { address: `${removeTarget.localPart}@${removeTarget.domainHostname}` })
						: ""
				}
				confirmLabel={t("deleteAliasConfirm")}
				cancelLabel={tCommon("cancel")}
				danger
				onConfirm={() => {
					if (removeTarget) removeAlias.mutate(removeTarget.id);
					setRemoveTarget(null);
				}}
			/>

			<Card>
				<CardHeader>
					<CardTitle>{t("createAliasTitle")}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<FormField label={t("aliasType")} htmlFor="alias-type">
						<Select
							id="alias-type"
							value={kind}
							onChange={(event) => setKind(event.target.value as AliasKind)}
						>
							<option value="mailbox">{t("aliasKindMailbox")}</option>
							<option value="group">{t("aliasKindGroup")}</option>
						</Select>
					</FormField>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<FormField label={t("localPart")} htmlFor="alias-local-part">
							<Input
								id="alias-local-part"
								placeholder={t("usernamePlaceholder")}
								value={localPart}
								onChange={(e) => setLocalPart(e.target.value)}
							/>
						</FormField>
						<FormField label={t("domain")} htmlFor="alias-domain">
							<Select
								id="alias-domain"
								value={domainId}
								onChange={(e) => setDomainId(e.target.value)}
							>
								<option value="">{t("selectDomain")}</option>
								{domains.map((d) => (
									<option key={d.id} value={d.id}>{d.hostname}</option>
								))}
							</Select>
						</FormField>
					</div>
					{kind === "mailbox" ? (
						<FormField label={t("deliverToMailbox")} htmlFor="alias-target">
							<Select
								id="alias-target"
								value={targetMailboxId}
								onChange={(event) => setTargetMailboxId(event.target.value)}
							>
								<option value="">{t("selectMailbox")}</option>
								{mailboxes.map((mailbox) => (
									<option key={mailbox.id} value={mailbox.id}>
										{mailboxAddress(mailbox.id)}
										{mailbox.displayName ? ` (${mailbox.displayName})` : ""}
									</option>
								))}
							</Select>
						</FormField>
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
						{t("externalForwardingNote")}
					</p>
					<Button
						onClick={() => create.mutate()}
						disabled={
							create.isPending ||
							!domainId ||
							!localPart ||
							(kind === "mailbox" ? !targetMailboxId : groupMailboxIds.length < 2)
						}
					>
						<Plus className="h-4 w-4 mr-2" />
						{kind === "group" ? t("createGroup") : t("createAliasTitle")}
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("activeAliases")}</CardTitle>
				</CardHeader>
				<CardContent>
					<ListSection
						loading={false}
						loadingLabel={t("loadingAliases")}
						empty={aliases.length === 0}
						emptyLabel={t("noAliases")}
						emptyIcon={AtSign}
					>
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
													? t("mailboxGroupCount", { count: a.members.length })
													: a.forwardTo
														? t("legacyForwardingUnavailable")
														: mailboxAddress(a.targetMailboxId)}
											</span>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setRemoveTarget(a)}
											className="text-danger hover:text-danger"
											aria-label={t("deleteAliasAria", { address: `${a.localPart}@${a.domainHostname}` })}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
									{a.isGroup && (
										<div className="rounded-md border border-border p-3 space-y-3">
											<div className="flex items-center gap-2 text-sm font-medium text-ink">
												<Users className="h-4 w-4" />
												{t("groupMembers")}
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
												label={t("groupMembersFor", { address: `${a.localPart}@${a.domainHostname}` })}
											/>
											<Button
												size="sm"
												onClick={() => requestGroupSave(a.id)}
												disabled={
													(saveGroup.isPending && saveGroup.variables === a.id) ||
													(groupEdits[a.id]?.length ?? 0) < 2
												}
											>
												{t("saveMembers")}
											</Button>
										</div>
									)}
								</li>
							))}
						</ul>
					</ListSection>
				</CardContent>
			</Card>
		</div>
	);
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
