"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import type { ApiKey } from "./types";
import {
	createApiKey,
	formatApiKeyTimestamp,
	listApiKeys,
	parseApiKeyScopes,
	revokeApiKey,
	type CreatedApiKey,
} from "./utils";

export default function ApiKeysPage() {
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

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-4">
				<h1 className="text-2xl font-semibold">API Keys</h1>
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
							New API key
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Create API key</DialogTitle>
							<DialogDescription>Create a key with send and read permissions.</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="api-key-name">Name</Label>
								<Input
									id="api-key-name"
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder="Production app"
								/>
							</div>
							{create.isError && <p className="text-sm text-danger">{create.error.message}</p>}
							<Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
								{create.isPending ? "Creating..." : "Create key"}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>

			<Dialog open={createdKey !== null} onOpenChange={closeSecretDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Save this API key now</DialogTitle>
						<DialogDescription>
							This secret is shown only once and cannot be recovered after you close this window.
						</DialogDescription>
					</DialogHeader>
					<code className="block break-all rounded-md border bg-surface-subtle p-3 text-xs font-semibold">
						{createdKey?.key}
					</code>
					{copyError && <p className="text-sm text-danger">Copy failed. Select and copy the key manually.</p>}
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button variant="outline" onClick={copyCreatedKey}>
							<Copy className="h-4 w-4" />
							{copied ? "Copied" : "Copy key"}
						</Button>
						<Button onClick={() => closeSecretDialog(false)}>Done</Button>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog
				open={revokeTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRevokeTarget(null);
						revoke.reset();
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Revoke API key?</DialogTitle>
						<DialogDescription>
							{revokeTarget?.name} will stop working immediately. This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					{revoke.isError && <p className="text-sm text-danger">{revoke.error.message}</p>}
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button
							variant="outline"
							onClick={() => {
								setRevokeTarget(null);
								revoke.reset();
							}}
							disabled={revoke.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => revokeTarget && revoke.mutate(revokeTarget.id)}
							disabled={revoke.isPending}
						>
							{revoke.isPending ? "Revoking..." : "Revoke key"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<section className="space-y-3">
				<span className="text-sm text-ink-muted">{apiKeys.length} total</span>
				{isLoading && (
					<p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-ink-muted">
						Loading API keys...
					</p>
				)}
				{!isLoading && apiKeys.length === 0 && (
					<p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-ink-muted">
						No API keys yet
					</p>
				)}
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
										{key.revokedAt ? "Revoked" : "Active"}
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
									Created {formatApiKeyTimestamp(key.createdAt)}
								</span>
								<span className="block text-xs text-ink-muted">
									Last used {formatApiKeyTimestamp(key.lastUsedAt)}
								</span>
								{key.revokedAt && (
									<span className="block text-xs text-ink-muted">
										Revoked {formatApiKeyTimestamp(key.revokedAt)}
									</span>
								)}
								{!key.revokedAt && (
									<Button size="sm" variant="outline" onClick={() => setRevokeTarget(key)}>
										<Ban className="h-4 w-4" />
										Revoke
									</Button>
								)}
							</span>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
