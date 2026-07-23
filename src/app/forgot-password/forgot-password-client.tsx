"use client";

import Link from "next/link";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "./utils";

export function ForgotPasswordClient() {
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setLoading(true);
		setError(null);
		try {
			const form = new FormData(event.currentTarget);
			setMessage(await requestPasswordReset(String(form.get("email") ?? "")));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Unable to request a reset link");
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthShell
			icon={KeyRound}
			title="Forgot your password?"
			description="Enter your Lumimail account email. If recovery is configured, we’ll send a secure link to your recovery address."
			footer={<Link href="/login" className="hover:underline">Back to sign in</Link>}
		>
			{message ? (
				<div className="rounded-2xl border border-success/30 bg-success-muted px-4 py-4 text-sm text-success">
					<p className="font-semibold">Check your recovery email</p>
					<p className="mt-1">{message}</p>
				</div>
			) : (
				<form onSubmit={onSubmit} className="space-y-5">
					<div className="space-y-2">
						<Label htmlFor="email">Account email</Label>
						<Input id="email" name="email" type="email" autoComplete="email" required />
					</div>
					{error && (
						<p role="alert" className="rounded-2xl border border-danger/30 bg-danger-muted px-4 py-3 text-sm font-medium text-danger">
							{error}
						</p>
					)}
					<Button type="submit" className="h-11 w-full rounded-full px-6 active:scale-[0.98]" disabled={loading}>
						{loading ? "Sending reset link..." : "Send reset link"}
					</Button>
				</form>
			)}
		</AuthShell>
	);
}
