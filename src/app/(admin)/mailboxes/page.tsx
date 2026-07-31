"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
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
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ListSection } from "@/components/ui/list-section";
import { domainKeys, mailboxKeys } from "@/lib/query-keys";
import { apiJson } from "@/lib/api/client-response";
import type { Domain, Mailbox } from "./types";
import { getMailboxAddress, getMailboxName } from "./utils";
import { Select } from "@/components/ui/select";

export default function MailboxesPage() {
	const t = useTranslations("admin");
	const qc = useQueryClient();
	const [localPart, setLocalPart] = useState("");
	const [domainId, setDomainId] = useState("");
	const [createOpen, setCreateOpen] = useState(false);

	const domains = useQuery({
		queryKey: domainKeys.list({ includeDns: false }),
		queryFn: () => apiJson.get<{ domains: Domain[] }>("/api/domains"),
	});

	const mailboxes = useQuery({
		queryKey: mailboxKeys.admin,
		queryFn: () =>
			apiJson.get<{
				mailboxes: Mailbox[];
				canSelfAssign: boolean;
				currentUserId: string;
			}>("/api/admin/mailboxes"),
	});

	const claimAccess = useMutation({
		mutationFn: async (mailboxId: string) => {
			await apiJson.post<{ id: string }>(`/api/mailboxes/${mailboxId}/members`, {
				userId: mailboxes.data?.currentUserId,
				role: "manager",
			});
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: mailboxKeys.admin });
			qc.invalidateQueries({ queryKey: mailboxKeys.user });
		},
	});

	const create = useMutation({
		mutationFn: async () => {
			await apiJson.post<{ id: string; address: string }>("/api/mailboxes", {
				domainId,
				localPart,
				displayName: localPart,
			});
			setLocalPart("");
			setDomainId("");
		},
		meta: { suppressErrorToast: true },
		onSuccess: () => {
			setCreateOpen(false);
			qc.invalidateQueries({ queryKey: mailboxKeys.admin });
			qc.invalidateQueries({ queryKey: mailboxKeys.user });
		},
	});

	const domainMap = new Map(
		(domains.data?.domains ?? []).map((d) => [d.id, d.hostname]),
	);

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-4">
				<h1 className="text-2xl font-semibold text-ink">{t("mailboxesTitle")}</h1>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus className="h-4 w-4" />
							{t("newMailbox")}
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("createMailboxTitle")}</DialogTitle>
							<DialogDescription>{t("createMailboxDesc")}</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							<FormField label={t("domain")}>
								<Select
									value={domainId}
									onChange={(event) => setDomainId(event.target.value)}
								>
									<option value="">{t("selectDomain")}</option>
									{(domains.data?.domains ?? []).map((domain) => (
										<option key={domain.id} value={domain.id}>
											{domain.hostname}
										</option>
									))}
								</Select>
							</FormField>
							<FormField label={t("username")} className="relative">
								<Input
									value={localPart}
									onChange={(event) => setLocalPart(event.target.value)}
									placeholder={t("usernamePlaceholder")}
								/>
								{domainId && (
									<span className="absolute bottom-2.5 right-4 text-sm text-ink-faint">
										@{domainMap.get(domainId)}
									</span>
								)}
							</FormField>
							{create.isError && (
								<p className="text-sm text-danger">{(create.error as Error).message}</p>
							)}
							<Button
								onClick={() => create.mutate()}
								disabled={!domainId || !localPart || create.isPending}
							>
								{create.isPending ? t("creating") : t("createMailboxTitle")}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
			<section className="space-y-3">
				<ListSection
					loading={mailboxes.isLoading}
					loadingLabel={t("loadingMailboxes")}
					empty={(mailboxes.data?.mailboxes ?? []).length === 0}
					emptyLabel={t("noMailboxes")}
					emptyIcon={Mail}
				>
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
										{mailbox.role ?? t("noContentAccess")}
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
										{t("claimAccess")}
									</Button>
								)}
							</div>
						);
					})}
				</div>
				</ListSection>
			</section>
		</div>
	);
}
