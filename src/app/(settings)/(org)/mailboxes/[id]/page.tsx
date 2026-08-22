"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mailboxKeys } from "@/lib/query-keys";
import { ArrowLeft, Mail, Save, Trash2, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
	addMailboxMember,
	deleteMailbox,
	fetchMailbox,
	fetchMailboxMembers,
	getMailboxAddress,
	removeMailboxMember,
	updateMailboxMemberRole,
	updateMailboxName,
} from "./utils";
import type { MailboxDetail, MailboxMember, MailboxRole, WorkspaceMember } from "./types";
import { Select } from "@/components/ui/select";

function MailboxSettingsCard({
	displayName, localPart, loading, pending, error, success, onNameChange, onSave,
}: {
	displayName: string; localPart?: string; loading: boolean; pending: boolean;
	error: unknown; success: boolean; onNameChange: (value: string) => void; onSave: () => void;
}) {
	const t = useTranslations("admin");
	const tCommon = useTranslations("common");
	return <Card>
		<CardHeader><CardTitle>{t("mailboxSettings")}</CardTitle><CardDescription>{t("mailboxSettingsDesc")}</CardDescription></CardHeader>
		<CardContent className="space-y-4">
			<FormField label={t("mailboxName")} htmlFor="displayName">
				<Input id="displayName" value={displayName} onChange={(event) => onNameChange(event.target.value)} placeholder={localPart ?? t("mailboxNamePlaceholder")} disabled={loading || pending} />
			</FormField>
			{error ? <p className="text-sm text-danger">{error instanceof Error ? error.message : t("updateFailed")}</p> : null}
			{success && <p className="text-sm text-success">{t("mailboxSaved")}</p>}
			<Button onClick={onSave} disabled={loading || pending}><Save className="h-4 w-4" />{pending ? tCommon("saving") : t("saveChanges")}</Button>
		</CardContent>
	</Card>;
}

function MailboxAccessCard({
	members, availableMembers, newMemberId, newMemberRole, loading, pending, error,
	onMemberIdChange, onRoleChange, onAdd, onMemberRoleChange, onRemove,
}: {
	members: MailboxMember[]; availableMembers: WorkspaceMember[]; newMemberId: string; newMemberRole: MailboxRole;
	loading: boolean; pending: boolean; error?: string;
	onMemberIdChange: (value: string) => void; onRoleChange: (value: MailboxRole) => void; onAdd: () => void;
	onMemberRoleChange: (id: string, role: MailboxRole) => void; onRemove: (member: MailboxMember) => void;
}) {
	const t = useTranslations("admin");
	const tCommon = useTranslations("common");
	return <Card>
		<CardHeader><CardTitle>{t("mailboxAccessTitle")}</CardTitle><CardDescription>{t("mailboxAccessDesc")}</CardDescription></CardHeader>
		<CardContent className="space-y-4">
			<div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
				<Select value={newMemberId} onChange={(event) => onMemberIdChange(event.target.value)} className="w-auto">
					<option value="">{t("selectWorkspaceMember")}</option>
					{availableMembers.map((member) => <option key={member.userId} value={member.userId}>{member.name} ({member.email})</option>)}
				</Select>
				<Select value={newMemberRole} onChange={(event) => onRoleChange(event.target.value as MailboxRole)} className="w-auto">
					<option value="viewer">{t("roleViewer")}</option><option value="responder">{t("roleResponder")}</option><option value="manager">{t("roleManager")}</option>
				</Select>
				<Button onClick={onAdd} disabled={!newMemberId || pending}><UserPlus className="h-4 w-4" /> {tCommon("add")}</Button>
			</div>
			{loading && <p className="text-sm text-ink-muted">{t("loadingMailboxAccess")}</p>}
			{error && <p className="text-sm text-danger">{error}</p>}
			<div className="divide-y divide-border rounded-md border border-border">
				{members.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 px-3 py-3">
					<div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{member.name}</p><p className="truncate text-xs text-ink-muted">{member.email}</p></div>
					<div className="flex items-center gap-2">
						<Select value={member.role} onChange={(event) => onMemberRoleChange(member.id, event.target.value as MailboxRole)} size="sm" className="w-auto">
							<option value="viewer">{t("roleViewer")}</option><option value="responder">{t("roleResponder")}</option><option value="manager">{t("roleManager")}</option>
						</Select>
						<Button variant="ghost" size="sm" onClick={() => onRemove(member)} aria-label={t("removeMemberAria", { email: member.email })}><X className="h-4 w-4" /></Button>
					</div>
				</div>)}
			</div>
		</CardContent>
	</Card>;
}

function MailboxAddressCard({ mailbox, address }: { mailbox?: MailboxDetail; address: string }) {
	const t = useTranslations("admin");
	const fields: Array<[string, string | undefined]> = [["fieldEmail", address], ["fieldUsername", mailbox?.localPart], ["fieldDomain", mailbox?.hostname]];
	return <Card>
		<CardHeader><CardTitle>{t("mailboxAddress")}</CardTitle><CardDescription>{t("addressDesc")}</CardDescription></CardHeader>
		<CardContent className="grid gap-4 sm:grid-cols-2">
			{fields.map(([label, value]) => <div key={label} className="space-y-1"><p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t(label)}</p><p className="truncate font-mono text-sm text-ink">{value || t("emptyFallback")}</p></div>)}
			<div className="space-y-1"><p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t("fieldRouting")}</p><p className="flex items-center gap-2 text-sm text-ink"><Mail className="h-4 w-4 text-ink-faint" />{t("cloudflareRouting")}</p></div>
		</CardContent>
	</Card>;
}

function DeleteMailboxCard({ address, confirmation, pending, error, onConfirmationChange, onDelete }: {
	address: string; confirmation: string; pending: boolean; error: unknown;
	onConfirmationChange: (value: string) => void; onDelete: () => void;
}) {
	const t = useTranslations("admin");
	const confirmed = !!address && confirmation.trim().toLowerCase() === address.toLowerCase();
	return <Card className="border-danger/30">
		<CardHeader><CardTitle className="text-danger">{t("deleteMailbox")}</CardTitle><CardDescription>{t("deleteMailboxDesc")}</CardDescription></CardHeader>
		<CardContent className="space-y-4">
			<FormField label={t("confirmMailboxAddress")} htmlFor="deleteConfirmation"><Input id="deleteConfirmation" value={confirmation} onChange={(event) => onConfirmationChange(event.target.value)} placeholder={address} autoComplete="off" /></FormField>
			{error ? <p className="text-sm text-danger">{error instanceof Error ? error.message : t("deleteMailboxFailed")}</p> : null}
			<Button variant="destructive" onClick={onDelete} disabled={!confirmed || pending}><Trash2 className="h-4 w-4" />{pending ? t("deleting") : t("deleteMailbox")}</Button>
		</CardContent>
	</Card>;
}

function changeMailboxMemberRole({ mailboxId, membershipId, role }: { mailboxId: string; membershipId: string; role: MailboxRole }) {
	return updateMailboxMemberRole(mailboxId, membershipId, role);
}

function getAvailableMembers(data: { members: MailboxMember[]; workspaceMembers: WorkspaceMember[] } | undefined) {
	const assignedUserIds = new Set((data?.members ?? []).map((member) => member.userId));
	return (data?.workspaceMembers ?? []).filter((member) => !assignedUserIds.has(member.userId));
}

function MailboxPageHeading({ mailbox, address }: { mailbox?: MailboxDetail; address: string }) {
	const t = useTranslations("admin");
	const tNav = useTranslations("nav");
	return <PageHeader
		title={mailbox?.displayName || mailbox?.localPart || t("mailbox")}
		description={<span className="font-mono">{address || t("loadingMailbox")}</span>}
		action={mailbox?.isPrimary ? <Badge variant="secondary">{tNav("primary")}</Badge> : null}
	/>;
}

function MailboxLoadError({ error }: { error: unknown }) {
	const t = useTranslations("admin");
	if (!error) return null;
	return <p className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-danger">
		{error instanceof Error ? error.message : t("failedMailbox")}
	</p>;
}

function MemberRemovalDialog({ target, pending, onClose, onConfirm }: {
	target: MailboxMember | null; pending: boolean; onClose: () => void; onConfirm: (id: string) => void;
}) {
	const t = useTranslations("admin");
	const tCommon = useTranslations("common");
	return <ConfirmDialog open={target !== null} onOpenChange={(open) => { if (!open && !pending) onClose(); }}
		title={t("removeAccessTitle")} description={target ? t("removeAccessDesc", { email: target.email }) : ""}
		confirmLabel={t("removeAccessConfirm")} cancelLabel={tCommon("cancel")} danger
		onConfirm={() => { if (target) onConfirm(target.id); onClose(); }} />;
}

export default function MailboxSettingsPage() {
	const t = useTranslations("admin");
	const params = useParams<{ id: string }>();
	const mailboxId = params.id;
	const router = useRouter();
	const qc = useQueryClient();
	const [displayName, setDisplayName] = useState("");
	const [deleteConfirmation, setDeleteConfirmation] = useState("");
	const [newMemberId, setNewMemberId] = useState("");
	const [newMemberRole, setNewMemberRole] = useState<MailboxRole>("responder");
	const [removeMemberTarget, setRemoveMemberTarget] = useState<MailboxMember | null>(null);

	const mailbox = useQuery({
		queryKey: ["mailbox", mailboxId],
		queryFn: () => fetchMailbox(mailboxId),
		enabled: !!mailboxId,
	});

	useEffect(() => {
		if (mailbox.data) setDisplayName(mailbox.data.displayName ?? "");
	}, [mailbox.data]);

	const updateName = useMutation({
		mutationFn: () => updateMailboxName(mailboxId, displayName),
		meta: { suppressErrorToast: true },
		onSuccess: (updatedMailbox) => {
			qc.setQueryData(["mailbox", mailboxId], updatedMailbox);
			qc.invalidateQueries({ queryKey: mailboxKeys.user });
			qc.invalidateQueries({ queryKey: mailboxKeys.admin });
		},
	});

	const removeMailbox = useMutation({
		mutationFn: () => deleteMailbox(mailboxId, deleteConfirmation),
		meta: { suppressErrorToast: true },
		onSuccess: () => {
			qc.removeQueries({ queryKey: ["mailbox", mailboxId] });
			qc.invalidateQueries({ queryKey: mailboxKeys.user });
			qc.invalidateQueries({ queryKey: mailboxKeys.admin });
			router.push("/mailboxes");
		},
	});

	const members = useQuery({
		queryKey: ["mailbox-members", mailboxId],
		queryFn: () => fetchMailboxMembers(mailboxId),
		enabled: !!mailboxId && mailbox.data?.role === "manager",
	});

	const addMember = useMutation({
		mutationFn: () => addMailboxMember(mailboxId, newMemberId, newMemberRole),
		meta: { suppressErrorToast: true },
		onSuccess: () => {
			setNewMemberId("");
			qc.invalidateQueries({ queryKey: ["mailbox-members", mailboxId] });
		},
	});

	const changeMemberRole = useMutation({
		mutationFn: changeMailboxMemberRole,
		meta: { suppressErrorToast: true },
		onSuccess: () => qc.invalidateQueries({ queryKey: ["mailbox-members", mailboxId] }),
	});

	const removeMember = useMutation({
		mutationFn: (membershipId: string) => removeMailboxMember(mailboxId, membershipId),
		meta: { suppressErrorToast: true },
		onSuccess: () => qc.invalidateQueries({ queryKey: ["mailbox-members", mailboxId] }),
	});

	const address = mailbox.data ? getMailboxAddress(mailbox.data) : "";
	const availableMembers = getAvailableMembers(members.data);
	const memberError = (members.error ?? addMember.error ?? changeMemberRole.error ?? removeMember.error)?.message;

	return (
		<div className="space-y-6">
			<MemberRemovalDialog target={removeMemberTarget} pending={removeMember.isPending}
				onClose={() => setRemoveMemberTarget(null)} onConfirm={(id) => removeMember.mutate(id)} />
			<div className="flex items-center gap-3">
				<Button asChild variant="ghost" size="sm">
					<Link href="/mailboxes">
						<ArrowLeft className="h-4 w-4" />
						{t("mailboxesTitle")}
					</Link>
				</Button>
			</div>

			<MailboxPageHeading mailbox={mailbox.data} address={address} />
			<MailboxLoadError error={mailbox.error} />

			<MailboxSettingsCard displayName={displayName} localPart={mailbox.data?.localPart}
				loading={mailbox.isLoading} pending={updateName.isPending} error={updateName.error}
				success={updateName.isSuccess} onNameChange={setDisplayName} onSave={() => updateName.mutate()} />

			{mailbox.data?.role === "manager" && <MailboxAccessCard
				members={members.data?.members ?? []} availableMembers={availableMembers}
				newMemberId={newMemberId} newMemberRole={newMemberRole} loading={members.isLoading}
				pending={addMember.isPending} error={memberError} onMemberIdChange={setNewMemberId}
				onRoleChange={setNewMemberRole} onAdd={() => addMember.mutate()}
				onMemberRoleChange={(membershipId, role) => changeMemberRole.mutate({ mailboxId, membershipId, role })}
				onRemove={setRemoveMemberTarget} />}

			<MailboxAddressCard mailbox={mailbox.data} address={address} />
			<DeleteMailboxCard address={address} confirmation={deleteConfirmation}
				pending={removeMailbox.isPending} error={removeMailbox.error}
				onConfirmationChange={setDeleteConfirmation} onDelete={() => removeMailbox.mutate()} />
		</div>
	);
}
