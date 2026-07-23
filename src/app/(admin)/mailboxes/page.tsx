"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import type { Domain, Mailbox } from "./types";
import { getMailboxAddress, getMailboxName } from "./utils";

export default function MailboxesPage() {
	const qc = useQueryClient();
	const [localPart, setLocalPart] = useState("");
	const [domainId, setDomainId] = useState("");
	const [createOpen, setCreateOpen] = useState(false);

	const domains = useQuery({
		queryKey: ["domains"],
		queryFn: async () => {
			const res = await authFetch("/api/domains");
			return (await res.json()) as { domains: Domain[] };
		},
	});

	const mailboxes = useQuery({
		queryKey: ["admin", "mailboxes"],
		queryFn: async () => {
			const res = await authFetch("/api/admin/mailboxes");
			return (await res.json()) as {
				mailboxes: Mailbox[];
				canSelfAssign: boolean;
				currentUserId: string;
			};
		},
	});

	const claimAccess = useMutation({
		mutationFn: async (mailboxId: string) => {
			const res = await authFetch(`/api/mailboxes/${mailboxId}/members`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userId: mailboxes.data?.currentUserId, role: "manager" }),
			});
			await parseApiResponse<{ id: string }>(res);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["admin", "mailboxes"] });
			qc.invalidateQueries({ queryKey: ["mailboxes"] });
		},
	});

	const create = useMutation({
		mutationFn: async () => {
			const res = await authFetch("/api/mailboxes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ domainId, localPart, displayName: localPart }),
			});
			await parseApiResponse<{ id: string; address: string }>(res);
			setLocalPart("");
			setDomainId("");
		},
		onSuccess: () => {
			setCreateOpen(false);
			qc.invalidateQueries({ queryKey: ["admin", "mailboxes"] });
			qc.invalidateQueries({ queryKey: ["mailboxes"] });
		},
	});

	const domainMap = new Map(
		(domains.data?.domains ?? []).map((d) => [d.id, d.hostname]),
	);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-4">
				<h1 className="text-2xl font-semibold text-ink">Mailboxes</h1>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus className="h-4 w-4" />
							New mailbox
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Create mailbox</DialogTitle>
							<DialogDescription>Add a mailbox and provision its routing rule automatically.</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							<div className="space-y-2">
								<Label>Domain</Label>
								<select
									className="w-full h-10 rounded-md border border-border px-3 text-sm shadow-sm shadow-border/50 placeholder:text-ink-muted focus-visible:outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
									value={domainId}
									onChange={(event) => setDomainId(event.target.value)}
								>
									<option value="">Select domain</option>
									{(domains.data?.domains ?? []).map((domain) => (
										<option key={domain.id} value={domain.id}>
											{domain.hostname}
										</option>
									))}
								</select>
							</div>
							<div className="space-y-2 relative">
								<Label>Username</Label>
								<Input
									value={localPart}
									onChange={(event) => setLocalPart(event.target.value)}
									placeholder="support"
								/>
								{domainId && (
									<span className="absolute bottom-2.5 right-4 text-sm text-ink-faint">
										@{domainMap.get(domainId)}
									</span>
								)}
							</div>
							{create.isError && (
								<p className="text-sm text-danger">{(create.error as Error).message}</p>
							)}
							<Button
								onClick={() => create.mutate()}
								disabled={!domainId || !localPart || create.isPending}
							>
								{create.isPending ? "Creating..." : "Create mailbox"}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
			<section className="space-y-3">
				{/* <div className="flex items-center justify-between">
					<span className="text-sm text-ink-muted">
						{(mailboxes.data?.mailboxes ?? []).length} total
					</span>
				</div> */}
				{mailboxes.isLoading && (
					<p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-ink-muted">
						Loading mailboxes...
					</p>
				)}
				{!mailboxes.isLoading && (mailboxes.data?.mailboxes ?? []).length === 0 && (
					<p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-ink-muted">
						No mailboxes yet
					</p>
				)}
				<div className="grid gap-3 md:grid-cols-2">
					{(mailboxes.data?.mailboxes ?? []).map((mailbox) => {
						const mailboxWithHostname = {
							...mailbox,
							hostname: mailbox.hostname ?? domainMap.get(mailbox.domainId) ?? "?",
						};

						const content = (
							<>
								<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-ink-muted group-hover:bg-accent-muted group-hover:text-accent">
									<Mail className="h-5 w-5" />
								</span>
								<span className="min-w-0 space-y-1">
									<span className="block truncate text-sm font-semibold text-ink">
										{getMailboxName(mailboxWithHostname)}
									</span>
									<span className="block truncate font-mono text-sm text-ink-muted">
										{getMailboxAddress(mailboxWithHostname)}
									</span>
									<span className="block text-xs capitalize text-ink-faint">
										{mailbox.role ?? "No content access"}
									</span>
								</span>
							</>
						);
						if (mailbox.role === "manager") {
							return (
								<Link
									key={mailbox.id}
									href={`/mailboxes/${mailbox.id}`}
									className="group flex min-h-24 items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-sm shadow-border transition hover:border-accent/30 hover:bg-surface hover:shadow-md"
								>
									{content}
								</Link>
							);
						}
						return (
							<div key={mailbox.id} className="group flex min-h-24 items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-sm shadow-border">
								{content}
								{!mailbox.role && mailboxes.data?.canSelfAssign && (
									<Button size="sm" variant="outline" onClick={() => claimAccess.mutate(mailbox.id)} disabled={claimAccess.isPending}>
										Claim access
									</Button>
								)}
							</div>
						);
					})}
				</div>
			</section>
		</div>
	);
}
