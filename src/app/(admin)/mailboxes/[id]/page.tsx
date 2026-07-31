"use client";

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
import type { MailboxMember, MailboxRole } from "./types";
import { Select } from "@/components/ui/select";

export default function MailboxSettingsPage() {
	const t = useTranslations("admin");
	const tCommon = useTranslations("common");
	const tNav = useTranslations("nav");
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
		mutationFn: ({ membershipId, role }: { membershipId: string; role: MailboxRole }) =>
			updateMailboxMemberRole(mailboxId, membershipId, role),
		meta: { suppressErrorToast: true },
		onSuccess: () => qc.invalidateQueries({ queryKey: ["mailbox-members", mailboxId] }),
	});

	const removeMember = useMutation({
		mutationFn: (membershipId: string) => removeMailboxMember(mailboxId, membershipId),
		meta: { suppressErrorToast: true },
		onSuccess: () => qc.invalidateQueries({ queryKey: ["mailbox-members", mailboxId] }),
	});

	const address = mailbox.data ? getMailboxAddress(mailbox.data) : "";
	const memberRemovalDialog = (
		<ConfirmDialog
			open={removeMemberTarget !== null}
			onOpenChange={(open) => {
				if (!open) setRemoveMemberTarget(null);
			}}
			title={t("removeAccessTitle")}
			description={
				removeMemberTarget ? t("removeAccessDesc", { email: removeMemberTarget.email }) : ""
			}
			confirmLabel={t("removeAccessConfirm")}
			cancelLabel={tCommon("cancel")}
			danger
			onConfirm={() => {
				if (removeMemberTarget) removeMember.mutate(removeMemberTarget.id);
				setRemoveMemberTarget(null);
			}}
		/>
	);
	const assignedUserIds = new Set((members.data?.members ?? []).map((member) => member.userId));
	const availableMembers = (members.data?.workspaceMembers ?? []).filter(
		(member) => !assignedUserIds.has(member.userId),
	);

	return (
		<div className="space-y-6">
			{memberRemovalDialog}
			<div className="flex items-center gap-3">
				<Button asChild variant="ghost" size="sm">
					<Link href="/mailboxes">
						<ArrowLeft className="h-4 w-4" />
						{t("mailboxesTitle")}
					</Link>
				</Button>
			</div>

			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h1 className="truncate text-2xl font-semibold text-ink">
						{mailbox.data?.displayName || mailbox.data?.localPart || t("mailbox")}
					</h1>
					<p className="mt-1 truncate font-mono text-sm text-ink-muted">
						{address || t("loadingMailbox")}
					</p>
				</div>
				{mailbox.data?.isPrimary && <Badge variant="secondary">{tNav("primary")}</Badge>}
			</div>

			{mailbox.isError && (
				<p className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-danger">
					{mailbox.error instanceof Error ? mailbox.error.message : t("failedMailbox")}
				</p>
			)}

			<Card>
				<CardHeader>
					<CardTitle>{t("mailboxSettings")}</CardTitle>
					<CardDescription>
						{t("mailboxSettingsDesc")}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<FormField label={t("mailboxName")} htmlFor="displayName">
						<Input
							id="displayName"
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
							placeholder={mailbox.data?.localPart ?? t("mailboxNamePlaceholder")}
							disabled={mailbox.isLoading || updateName.isPending}
						/>
					</FormField>
					{updateName.isError && (
						<p className="text-sm text-danger">
							{updateName.error instanceof Error
								? updateName.error.message
								: t("updateFailed")}
						</p>
					)}
					{updateName.isSuccess && (
						<p className="text-sm text-success">{t("mailboxSaved")}</p>
					)}
					<Button
						onClick={() => updateName.mutate()}
						disabled={mailbox.isLoading || updateName.isPending}
					>
						<Save className="h-4 w-4" />
						{updateName.isPending ? tCommon("saving") : t("saveChanges")}
					</Button>
				</CardContent>
			</Card>

			{mailbox.data?.role === "manager" && (
				<Card>
					<CardHeader>
						<CardTitle>{t("mailboxAccessTitle")}</CardTitle>
						<CardDescription>
							{t("mailboxAccessDesc")}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
							<Select
								value={newMemberId}
								onChange={(event) => setNewMemberId(event.target.value)}
								className="w-auto"
							>
								<option value="">{t("selectWorkspaceMember")}</option>
								{availableMembers.map((member) => (
									<option key={member.userId} value={member.userId}>{member.name} ({member.email})</option>
								))}
							</Select>
							<Select
								value={newMemberRole}
								onChange={(event) => setNewMemberRole(event.target.value as MailboxRole)}
								className="w-auto"
							>
								<option value="viewer">{t("roleViewer")}</option>
								<option value="responder">{t("roleResponder")}</option>
								<option value="manager">{t("roleManager")}</option>
							</Select>
							<Button onClick={() => addMember.mutate()} disabled={!newMemberId || addMember.isPending}>
								<UserPlus className="h-4 w-4" /> {tCommon("add")}
							</Button>
						</div>

						{members.isLoading && <p className="text-sm text-ink-muted">{t("loadingMailboxAccess")}</p>}
						{(members.error || addMember.error || changeMemberRole.error || removeMember.error) && (
							<p className="text-sm text-danger">
								{(members.error ?? addMember.error ?? changeMemberRole.error ?? removeMember.error)?.message}
							</p>
						)}
						<div className="divide-y divide-border rounded-md border border-border">
							{(members.data?.members ?? []).map((member) => (
								<div key={member.id} className="flex items-center justify-between gap-3 px-3 py-3">
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-ink">{member.name}</p>
										<p className="truncate text-xs text-ink-muted">{member.email}</p>
									</div>
									<div className="flex items-center gap-2">
										<Select
											value={member.role}
											onChange={(event) => changeMemberRole.mutate({ membershipId: member.id, role: event.target.value as MailboxRole })}
											size="sm" className="w-auto"
										>
											<option value="viewer">{t("roleViewer")}</option>
											<option value="responder">{t("roleResponder")}</option>
											<option value="manager">{t("roleManager")}</option>
										</Select>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setRemoveMemberTarget(member)}
											aria-label={t("removeMemberAria", { email: member.email })}
										>
											<X className="h-4 w-4" />
										</Button>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle>{t("mailboxAddress")}</CardTitle>
					<CardDescription>
						{t("addressDesc")}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-1">
						<p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t("fieldEmail")}</p>
						<p className="truncate font-mono text-sm text-ink">{address || t("emptyFallback")}</p>
					</div>
					<div className="space-y-1">
						<p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t("fieldUsername")}</p>
						<p className="truncate font-mono text-sm text-ink">
							{mailbox.data?.localPart ?? t("emptyFallback")}
						</p>
					</div>
					<div className="space-y-1">
						<p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t("fieldDomain")}</p>
						<p className="truncate font-mono text-sm text-ink">
							{mailbox.data?.hostname ?? t("emptyFallback")}
						</p>
					</div>
					<div className="space-y-1">
						<p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t("fieldRouting")}</p>
						<p className="flex items-center gap-2 text-sm text-ink">
							<Mail className="h-4 w-4 text-ink-faint" />
							{t("cloudflareRouting")}
						</p>
					</div>
				</CardContent>
			</Card>

			<Card className="border-danger/30">
				<CardHeader>
					<CardTitle className="text-danger">{t("deleteMailbox")}</CardTitle>
					<CardDescription>
						{t("deleteMailboxDesc")}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<FormField label={t("confirmMailboxAddress")} htmlFor="deleteConfirmation">
						<Input
							id="deleteConfirmation"
							value={deleteConfirmation}
							onChange={(event) => setDeleteConfirmation(event.target.value)}
							placeholder={address}
							autoComplete="off"
						/>
					</FormField>
					{removeMailbox.isError && (
						<p className="text-sm text-danger">
							{removeMailbox.error instanceof Error
								? removeMailbox.error.message
								: t("deleteMailboxFailed")}
						</p>
					)}
					<Button
						variant="destructive"
						onClick={() => removeMailbox.mutate()}
						disabled={
							!address ||
							deleteConfirmation.trim().toLowerCase() !== address.toLowerCase() ||
							removeMailbox.isPending
						}
					>
						<Trash2 className="h-4 w-4" />
						{removeMailbox.isPending ? t("deleting") : t("deleteMailbox")}
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
