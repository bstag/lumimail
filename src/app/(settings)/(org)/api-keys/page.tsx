"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import type { ApiKey } from "./types";
import {
	createApiKey,
	formatApiKeyTimestamp,
	listApiKeys,
	parseApiKeyScopes,
	revokeApiKey,
	type CreatedApiKey,
} from "./utils";

function localizeApiKeyTimestamp(
	value: string | null | undefined,
	locale: string,
	labels: { never: string; unknown: string },
): string {
	return formatApiKeyTimestamp(value, locale, undefined, labels);
}

export default function ApiKeysPage() {
	const t = useTranslations("admin");
	const tCommon = useTranslations("common");
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

	const { data: apiKeys = [], isLoading } = useQuery({
		queryKey: ["api-keys"],
		queryFn: listApiKeys,
	});

	const create = useMutation({
		mutationFn: () => createApiKey(name),
		onSuccess: (result) => {
			setCreatedKey(result);
			setName("");
			setCreateOpen(false);
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
		},
	});

	const revoke = useMutation({
		mutationFn: (id: string) => revokeApiKey(id),
		meta: { suppressErrorToast: true },
		onSuccess: () => {
			setRevokeTarget(null);
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
		},
	});

	async function copyCreatedKey() {
		if (!createdKey) return;
		try {
			await navigator.clipboard.writeText(createdKey.key);
			setCopied(true);
			setCopyError(false);
		} catch {
			setCopied(false);
			setCopyError(true);
		}
	}

	function closeSecretDialog(open: boolean) {
		if (open) return;
		setCreatedKey(null);
		setCopied(false);
		setCopyError(false);
	}

	const timestampLabels = { never: t("never"), unknown: t("unknown") };

	return (
		<div className="space-y-6">
			<PageHeader
				title={t("apiKeysTitle")}
				action={
				<Dialog
					open={createOpen}
					onOpenChange={(open) => {
						setCreateOpen(open);
						if (open) create.reset();
					}}
				>
					<DialogTrigger asChild>
						<Button>
							<Plus className="h-4 w-4" />
							{t("newApiKey")}
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("createApiKeyTitle")}</DialogTitle>
							<DialogDescription>{t("createApiKeyDesc")}</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							<FormField label={t("apiKeyName")} htmlFor="api-key-name">
								<Input
									id="api-key-name"
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder={t("apiKeyNamePlaceholder")}
								/>
							</FormField>
							{create.isError && <p className="text-sm text-danger">{create.error.message}</p>}
							<Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
								{create.isPending ? t("creating") : t("createKey")}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
				}
			/>

			<Dialog open={createdKey !== null} onOpenChange={closeSecretDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("saveKeyTitle")}</DialogTitle>
						<DialogDescription>
							{t("saveKeyDesc")}
						</DialogDescription>
					</DialogHeader>
					<code className="block break-all rounded-md border bg-surface-subtle p-3 text-xs font-semibold">
						{createdKey?.key}
					</code>
					{copyError && <p className="text-sm text-danger">{t("copyKeyFailed")}</p>}
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button variant="outline" onClick={copyCreatedKey}>
							<Copy className="h-4 w-4" />
							{copied ? tCommon("copied") : t("copyKeyButton")}
						</Button>
						<Button onClick={() => closeSecretDialog(false)}>{tCommon("done")}</Button>
					</div>
				</DialogContent>
			</Dialog>

			<ConfirmDialog
				open={revokeTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRevokeTarget(null);
						revoke.reset();
					}
				}}
				title={t("revokeKeyTitle")}
				description={t("revokeKeyDesc", { name: revokeTarget?.name ?? "" })}
				confirmLabel={revoke.isPending ? t("revokingKey") : t("revokeKeyConfirm")}
				cancelLabel={tCommon("cancel")}
				danger
				pending={revoke.isPending}
				error={revoke.isError ? revoke.error.message : null}
				onConfirm={() => revokeTarget && revoke.mutate(revokeTarget.id)}
			/>

			<section className="space-y-3">
				<span className="text-sm text-ink-muted">{t("total", { count: apiKeys.length })}</span>
				<ListSection
					loading={isLoading}
					loadingLabel={t("loadingApiKeys")}
					empty={apiKeys.length === 0}
					emptyLabel={t("noApiKeys")}
					emptyIcon={KeyRound}
				>
				<div className="grid gap-3 md:grid-cols-2">
					{apiKeys.map((key) => (
						<div
							key={key.id}
							className="flex min-h-24 items-start gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-sm shadow-border"
						>
							<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-ink-muted">
								<KeyRound className="h-5 w-5" />
							</span>
							<span className="min-w-0 flex-1 space-y-2">
								<span className="flex items-center justify-between gap-2">
									<span className="truncate text-sm font-semibold text-ink">{key.name}</span>
									<Badge variant={key.revokedAt ? "secondary" : "outline"}>
										{key.revokedAt ? t("revoked") : t("active")}
									</Badge>
								</span>
								<span className="block truncate font-mono text-sm text-ink-muted">{key.prefix}...</span>
								<span className="flex flex-wrap gap-1">
									{parseApiKeyScopes(key.scopes).map((scope) => (
										<Badge key={scope} variant="outline">
											{scope}
										</Badge>
									))}
								</span>
								<span className="block text-xs text-ink-muted">
									{t("createdAt", { timestamp: localizeApiKeyTimestamp(key.createdAt, locale, timestampLabels) })}
								</span>
								<span className="block text-xs text-ink-muted">
									{t("lastUsedAt", { timestamp: localizeApiKeyTimestamp(key.lastUsedAt, locale, timestampLabels) })}
								</span>
								{key.revokedAt && (
									<span className="block text-xs text-ink-muted">
										{t("revokedAt", { timestamp: localizeApiKeyTimestamp(key.revokedAt, locale, timestampLabels) })}
									</span>
								)}
								{!key.revokedAt && (
									<Button size="sm" variant="outline" onClick={() => setRevokeTarget(key)}>
										<Ban className="h-4 w-4" />
										{t("revoke")}
									</Button>
								)}
							</span>
						</div>
					))}
				</div>
				</ListSection>
			</section>
		</div>
	);
}
