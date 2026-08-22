"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson, ApiResponseError } from "@/lib/api/client-response";
import type { ProfileFormProps, ProfileFormResponse } from "./types";

type ProfileSaveResult =
	| { ok: true; name: string; resetEmail: string }
	| { ok: false; message: string };

type ProfilePatch = (name: string, resetEmail: string) => Promise<ProfileFormResponse>;

function patchProfile(name: string, resetEmail: string) {
	return apiJson.patch<ProfileFormResponse>("/api/settings/profile", { name, resetEmail });
}

export async function saveProfile(
	name: string,
	resetEmail: string,
	failureMessage: string,
	request: ProfilePatch = patchProfile,
): Promise<ProfileSaveResult> {
	try {
		const data = await request(name, resetEmail);
		return {
			ok: true,
			name: data.user?.name ?? name.trim(),
			resetEmail: data.user?.resetEmail ?? "",
		};
	} catch (error) {
		return {
			ok: false,
			message: error instanceof ApiResponseError ? error.message : failureMessage,
		};
	}
}

export function ProfileForm({ initialName, initialResetEmail, email }: ProfileFormProps) {
	const t = useTranslations("settings");
	const [name, setName] = useState(initialName);
	const [resetEmail, setResetEmail] = useState(initialResetEmail);
	const [savedName, setSavedName] = useState(initialName);
	const [savedResetEmail, setSavedResetEmail] = useState(initialResetEmail);
	const [status, setStatus] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const hasChanges = name.trim() !== savedName || resetEmail.trim() !== savedResetEmail;

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		setStatus(null);

		const result = await saveProfile(name, resetEmail, t("accountFailed"));
		setLoading(false);
		if (!result.ok) {
			setStatus(result.message);
			return;
		}

		const nextName = result.name;
		const nextResetEmail = result.resetEmail;
		setName(nextName);
		setResetEmail(nextResetEmail);
		setSavedName(nextName);
		setSavedResetEmail(nextResetEmail);
		setStatus(t("saved"));
	}

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="name">{t("profileName")}</Label>
				<Input id="name" value={name} onChange={(event) => setName(event.target.value)} required />
			</div>
			<div className="space-y-2">
				<Label htmlFor="resetEmail">{t("recoveryEmail")}</Label>
				<Input
					id="resetEmail"
					value={resetEmail}
					onChange={(event) => setResetEmail(event.target.value)}
					type="email"
					placeholder={t("recoveryPlaceholder")}
				/>
			</div>
			<div className="space-y-1 rounded-md border border-border bg-surface-subtle px-3 py-2">
				<Label>{t("accountEmail")}</Label>
				<p className="text-sm text-ink-muted">{email}</p>
			</div>
			<div className="flex items-center gap-3">
				<Button type="submit" disabled={loading || !hasChanges}>
					{loading ? t("saving") : t("save")}
				</Button>
				{status && <p className="text-sm text-ink-muted">{status}</p>}
			</div>
		</form>
	);
}
