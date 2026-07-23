"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, Save, Trash2, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { MailboxRole } from "./types";

export default function MailboxSettingsPage() {
	const params = useParams<{ id: string }>();
	const mailboxId = params.id;
	const router = useRouter();
	const qc = useQueryClient();
	const [displayName, setDisplayName] = useState("");
	const [deleteConfirmation, setDeleteConfirmation] = useState("");
	const [newMemberId, setNewMemberId] = useState("");
	const [newMemberRole, setNewMemberRole] = useState<MailboxRole>("responder");

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
		onSuccess: (updatedMailbox) => {
			qc.setQueryData(["mailbox", mailboxId], updatedMailbox);
			qc.invalidateQueries({ queryKey: ["mailboxes"] });
			qc.invalidateQueries({ queryKey: ["admin", "mailboxes"] });
		},
	});

	const removeMailbox = useMutation({
		mutationFn: () => deleteMailbox(mailboxId, deleteConfirmation),
		onSuccess: () => {
			qc.removeQueries({ queryKey: ["mailbox", mailboxId] });
			qc.invalidateQueries({ queryKey: ["mailboxes"] });
			qc.invalidateQueries({ queryKey: ["admin", "mailboxes"] });
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
		onSuccess: () => {
			setNewMemberId("");
			qc.invalidateQueries({ queryKey: ["mailbox-members", mailboxId] });
		},
	});

	const changeMemberRole = useMutation({
		mutationFn: ({ membershipId, role }: { membershipId: string; role: MailboxRole }) =>
			updateMailboxMemberRole(mailboxId, membershipId, role),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["mailbox-members", mailboxId] }),
	});

	const removeMember = useMutation({
		mutationFn: (membershipId: string) => removeMailboxMember(mailboxId, membershipId),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["mailbox-members", mailboxId] }),
	});

	const address = mailbox.data ? getMailboxAddress(mailbox.data) : "";
	const assignedUserIds = new Set((members.data?.members ?? []).map((member) => member.userId));
	const availableMembers = (members.data?.workspaceMembers ?? []).filter(
		(member) => !assignedUserIds.has(member.userId),
	);

	return (
		<div className="max-w-3xl space-y-6">
			<div className="flex items-center gap-3">
				<Button asChild variant="ghost" size="sm">
					<Link href="/mailboxes">
						<ArrowLeft className="h-4 w-4" />
						Mailboxes
					</Link>
				</Button>
			</div>

			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h1 className="truncate text-2xl font-semibold text-neutral-900">
						{mailbox.data?.displayName || mailbox.data?.localPart || "Mailbox"}
					</h1>
					<p className="mt-1 truncate font-mono text-sm text-neutral-500">
						{address || "Loading mailbox..."}
					</p>
				</div>
				{mailbox.data?.isPrimary && <Badge variant="secondary">Primary</Badge>}
			</div>

			{mailbox.isError && (
				<p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{mailbox.error instanceof Error ? mailbox.error.message : "Failed to load mailbox"}
				</p>
			)}

			<Card>
				<CardHeader>
					<CardTitle>Settings</CardTitle>
					<CardDescription>
						Update the mailbox label shown in selectors and mailbox lists.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="displayName">Name</Label>
						<Input
							id="displayName"
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
							placeholder={mailbox.data?.localPart ?? "Mailbox name"}
							disabled={mailbox.isLoading || updateName.isPending}
						/>
					</div>
					{updateName.isError && (
						<p className="text-sm text-red-600">
							{updateName.error instanceof Error
								? updateName.error.message
								: "Failed to update mailbox"}
						</p>
					)}
					{updateName.isSuccess && (
						<p className="text-sm text-green-700">Mailbox settings saved</p>
					)}
					<Button
						onClick={() => updateName.mutate()}
						disabled={mailbox.isLoading || updateName.isPending}
					>
						<Save className="h-4 w-4" />
						{updateName.isPending ? "Saving..." : "Save changes"}
					</Button>
				</CardContent>
			</Card>

			{mailbox.data?.role === "manager" && (
				<Card>
					<CardHeader>
						<CardTitle>Mailbox access</CardTitle>
						<CardDescription>
							Choose who can read, reply from, or manage this mailbox. Workspace roles do not grant email access automatically.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
							<select
								value={newMemberId}
								onChange={(event) => setNewMemberId(event.target.value)}
								className="h-10 rounded-md border border-neutral-200 bg-white px-3 text-sm"
							>
								<option value="">Select workspace member</option>
								{availableMembers.map((member) => (
									<option key={member.userId} value={member.userId}>{member.name} ({member.email})</option>
								))}
							</select>
							<select
								value={newMemberRole}
								onChange={(event) => setNewMemberRole(event.target.value as MailboxRole)}
								className="h-10 rounded-md border border-neutral-200 bg-white px-3 text-sm"
							>
								<option value="viewer">Viewer</option>
								<option value="responder">Responder</option>
								<option value="manager">Manager</option>
							</select>
							<Button onClick={() => addMember.mutate()} disabled={!newMemberId || addMember.isPending}>
								<UserPlus className="h-4 w-4" /> Add
							</Button>
						</div>

						{members.isLoading && <p className="text-sm text-neutral-500">Loading mailbox access…</p>}
						{(members.error || addMember.error || changeMemberRole.error || removeMember.error) && (
							<p className="text-sm text-red-600">
								{(members.error ?? addMember.error ?? changeMemberRole.error ?? removeMember.error)?.message}
							</p>
						)}
						<div className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
							{(members.data?.members ?? []).map((member) => (
								<div key={member.id} className="flex items-center justify-between gap-3 px-3 py-3">
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-neutral-900">{member.name}</p>
										<p className="truncate text-xs text-neutral-500">{member.email}</p>
									</div>
									<div className="flex items-center gap-2">
										<select
											value={member.role}
											onChange={(event) => changeMemberRole.mutate({ membershipId: member.id, role: event.target.value as MailboxRole })}
											className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs"
										>
											<option value="viewer">Viewer</option>
											<option value="responder">Responder</option>
											<option value="manager">Manager</option>
										</select>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => {
												if (confirm(`Remove ${member.email} from this mailbox?`)) removeMember.mutate(member.id);
											}}
											aria-label={`Remove ${member.email}`}
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
					<CardTitle>Address</CardTitle>
					<CardDescription>
						The email address, username, and domain are managed as routing resources.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-1">
						<p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Email</p>
						<p className="truncate font-mono text-sm text-neutral-900">{address || "-"}</p>
					</div>
					<div className="space-y-1">
						<p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Username</p>
						<p className="truncate font-mono text-sm text-neutral-900">
							{mailbox.data?.localPart ?? "-"}
						</p>
					</div>
					<div className="space-y-1">
						<p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Domain</p>
						<p className="truncate font-mono text-sm text-neutral-900">
							{mailbox.data?.hostname ?? "-"}
						</p>
					</div>
					<div className="space-y-1">
						<p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Routing</p>
						<p className="flex items-center gap-2 text-sm text-neutral-900">
							<Mail className="h-4 w-4 text-neutral-400" />
							Cloudflare Email Routing
						</p>
					</div>
				</CardContent>
			</Card>

			<Card className="border-red-200">
				<CardHeader>
					<CardTitle className="text-red-700">Delete mailbox</CardTitle>
					<CardDescription>
						This permanently removes the mailbox and its stored data. Type the full
						mailbox address to confirm.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="deleteConfirmation">Confirm mailbox address</Label>
						<Input
							id="deleteConfirmation"
							value={deleteConfirmation}
							onChange={(event) => setDeleteConfirmation(event.target.value)}
							placeholder={address}
							autoComplete="off"
						/>
					</div>
					{removeMailbox.isError && (
						<p className="text-sm text-red-600">
							{removeMailbox.error instanceof Error
								? removeMailbox.error.message
								: "Failed to delete mailbox"}
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
						{removeMailbox.isPending ? "Deleting..." : "Delete mailbox"}
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
