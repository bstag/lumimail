"use client";

import Link from "next/link";
import { KeyRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitPasswordReset } from "./utils";

export function ResetPasswordClient() {
	const searchParams = useSearchParams();
	const email = searchParams.get("email") ?? "";
	const token = searchParams.get("token") ?? "";
	const validLink = Boolean(email && token);
	const [complete, setComplete] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const newPassword = String(form.get("newPassword") ?? "");
		const confirmation = String(form.get("confirmPassword") ?? "");
		if (newPassword !== confirmation) {
			setError("Passwords do not match");
			return;
		}

		setLoading(true);
		setError(null);
		try {
			await submitPasswordReset({ email, token, newPassword });
			setComplete(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Unable to reset password");
		} finally {
			setLoading(false);
		}
	}

	return (
		<AuthShell
			icon={KeyRound}
			title="Reset your password"
			description="Choose a new password with at least eight characters."
			footer={<Link href="/login" className="hover:underline">Back to sign in</Link>}
		>
			{!validLink ? (
				<p role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
					This reset link is incomplete or invalid. Request a new link and try again.
				</p>
			) : complete ? (
				<div className="rounded-2xl border border-green-100 bg-green-50 px-4 py-4 text-sm text-green-800">
					<p className="font-semibold">Password reset complete</p>
					<p className="mt-1">You can now sign in with your new password.</p>
				</div>
			) : (
				<form onSubmit={onSubmit} className="space-y-5">
					<div className="space-y-2">
						<Label htmlFor="newPassword">New password</Label>
						<Input id="newPassword" name="newPassword" type="password" minLength={8} autoComplete="new-password" required />
					</div>
					<div className="space-y-2">
						<Label htmlFor="confirmPassword">Confirm new password</Label>
						<Input id="confirmPassword" name="confirmPassword" type="password" minLength={8} autoComplete="new-password" required />
					</div>
					{error && (
						<p role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
							{error}
						</p>
					)}
					<Button type="submit" className="h-11 w-full rounded-full px-6 active:scale-[0.98]" disabled={loading}>
						{loading ? "Resetting password..." : "Reset password"}
					</Button>
				</form>
			)}
		</AuthShell>
	);
}
