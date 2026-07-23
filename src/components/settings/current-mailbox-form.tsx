"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMailboxAddress, updateCurrentMailboxName } from "./utils";

export function CurrentMailboxForm() {
	const t = useTranslations("settings");
	const { selectedMailbox, setSelectedMailbox, isLoading } = useSelectedMailbox();
	const [displayName, setDisplayName] = useState("");
	const [savedDisplayName, setSavedDisplayName] = useState("");
	const [status, setStatus] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		const nextName = selectedMailbox?.displayName ?? "";
		setDisplayName(nextName);
		setSavedDisplayName(nextName);
		setStatus(null);
	}, [selectedMailbox?.id, selectedMailbox?.displayName]);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedMailbox) return;

		setSaving(true);
		setStatus(null);
		try {
			const updated = await updateCurrentMailboxName(selectedMailbox.id, displayName);
			setSelectedMailbox(updated);
			setSavedDisplayName(updated.displayName ?? "");
			setDisplayName(updated.displayName ?? "");
			setStatus(t("saved"));
		} catch (err) {
			setStatus(err instanceof Error ? err.message : t("updateFailed"));
		} finally {
			setSaving(false);
		}
	}

	if (isLoading) {
		return (
			<div className="max-w-2xl space-y-6 p-8">
				<h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
				<Card>
					<CardContent className="p-6 text-sm text-ink-muted">{t("loadingMailbox")}</CardContent>
				</Card>
			</div>
		);
	}

	if (!selectedMailbox) {
		return (
			<div className="max-w-2xl space-y-6 p-8">
				<h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
				<Card>
					<CardContent className="p-6 text-sm text-ink-muted">
						{t("selectMailbox")}
					</CardContent>
				</Card>
			</div>
		);
	}

	const address = getMailboxAddress(selectedMailbox);
	const hasChanges = displayName.trim() !== savedDisplayName;

	return (
		<div className="max-w-2xl space-y-6 p-8">
			<div>
				<h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
				<p className="mt-1 text-sm text-ink-muted">{address}</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t("mailboxTitle")}</CardTitle>
					<CardDescription>{t("mailboxDesc")}</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={onSubmit} className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="displayName">{t("name")}</Label>
							<Input
								id="displayName"
								value={displayName}
								onChange={(event) => setDisplayName(event.target.value)}
								placeholder={selectedMailbox.localPart}
								disabled={saving}
							/>
						</div>
						<div className="grid gap-4 rounded-md border border-border bg-surface-subtle px-3 py-3 sm:grid-cols-2">
							<div className="space-y-1">
								<p className="text-xs font-medium uppercase text-ink-muted">{t("email")}</p>
								<p className="truncate font-mono text-sm text-ink">{address}</p>
							</div>
							<div className="space-y-1">
								<p className="text-xs font-medium uppercase text-ink-muted">{t("domain")}</p>
								<p className="truncate font-mono text-sm text-ink">{selectedMailbox.hostname}</p>
							</div>
						</div>
						<div className="flex items-center gap-3">
							<Button type="submit" disabled={saving || !hasChanges}>
								<Save className="h-4 w-4" />
								{saving ? t("saving") : t("saveChanges")}
							</Button>
							{status && <p className="text-sm text-ink-muted">{status}</p>}
						</div>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
