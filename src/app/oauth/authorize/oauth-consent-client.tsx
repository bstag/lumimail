"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, Eye, Mail, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth/client";
import { apiJson, parseApiResponse } from "@/lib/api/client-response";
import { cn } from "@/lib/utils";

type ConsentSummary = {
	clientName: string;
	requestedScopes: string[];
	defaultProfile: "read";
};

export function OAuthConsentClient({ initialSummary = null, initialProfile = "read", initialPassword = "" }: {
	initialSummary?: ConsentSummary | null; initialProfile?: "read" | "actions"; initialPassword?: string;
} = {}) {
	const router = useRouter();
	const [query] = useState(() => typeof window === "undefined" ? "" : window.location.search);
	const [summary, setSummary] = useState<ConsentSummary | null>(initialSummary);
	const [profile, setProfile] = useState<"read" | "actions">(initialProfile);
	const [password, setPassword] = useState(initialPassword);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const authorizationQuery = query;
		void (async () => {
			try {
				const response = await authFetch(
					`/api/mcp/authorization?authorizationQuery=${encodeURIComponent(authorizationQuery)}`,
					{ redirectOnUnauthorized: false },
				);
				if (response.status === 401) {
					const continuation = `${globalThis.location.pathname}${globalThis.location.search}`;
					router.push(`/login?redirect=${encodeURIComponent(continuation)}`);
					return;
				}
				setSummary(await parseApiResponse<ConsentSummary>(response));
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : "Authorization request is invalid");
			}
		})();
	}, [query, router]);

	async function approve() {
		setPending(true);
		setError(null);
		try {
			await apiJson.post("/api/auth/reconfirm", { password });
			const result = await apiJson.post<{ redirectTo: string }>("/api/mcp/authorization", {
				authorizationQuery: query,
				decision: "approve",
				profile,
			});
			globalThis.location.assign(result.redirectTo);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Authorization could not be completed");
			setPending(false);
		}
	}

	async function deny() {
		setPending(true);
		setError(null);
		try {
			const result = await apiJson.post<{ redirectTo: string }>("/api/mcp/authorization", {
				authorizationQuery: query,
				decision: "deny",
			});
			globalThis.location.assign(result.redirectTo);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Authorization request is invalid");
			setPending(false);
		}
	}

	const actionsRequested = summary?.requestedScopes.includes("mail.actions") ?? false;
	return (
		<AuthShell
			title="Connect to Picket"
			description={summary ? `${summary.clientName} is requesting access to your mail.` : "Review this integration request before continuing."}
			footer={<span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" />You can revoke this connection from Settings.</span>}
		>
			<div className="w-full max-w-lg space-y-5">
				{!summary && !error && <p className="text-sm text-ink-muted" role="status">Validating the client and redirect…</p>}
				{summary && (
					<>
						<div className="flex items-center gap-3 rounded-lg border border-border bg-surface-subtle p-4">
							<Bot className="h-6 w-6 text-accent" aria-hidden="true" />
							<div><p className="font-semibold text-ink">{summary.clientName}</p><p className="text-xs text-ink-muted">OAuth client</p></div>
						</div>
						<fieldset className="space-y-3">
							<legend className="text-sm font-semibold text-ink">Choose access</legend>
							{([
								{ id: "read" as const, icon: Eye, title: "Read only", body: "List your permitted mailboxes and read bounded message, thread, and attachment data." },
								{ id: "actions" as const, icon: Mail, title: "Mail actions", body: "Also change mail state, manage drafts, and send mail with retry-safe idempotency." },
							]).map((option) => {
								const disabled = option.id === "actions" && !actionsRequested;
								const Icon = option.icon;
								return (
									<label key={option.id} className={cn("flex cursor-pointer gap-3 rounded-lg border p-4", profile === option.id ? "border-accent bg-accent-muted" : "border-border", disabled && "cursor-not-allowed opacity-50")}>
										<input type="radio" name="profile" value={option.id} checked={profile === option.id} disabled={disabled} onChange={() => setProfile(option.id)} className="sr-only" />
										<Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
										<span><span className="flex items-center gap-2 font-medium text-ink">{option.title}{profile === option.id && <Check className="h-4 w-4" />}</span><span className="mt-1 block text-sm leading-5 text-ink-muted">{option.body}</span></span>
									</label>
								);
							})}
						</fieldset>
						<div className="space-y-2">
							<Label htmlFor="oauth-password">Confirm your password to approve</Label>
							<Input id="oauth-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
						</div>
					</>
				)}
				{error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-muted p-3 text-sm text-danger">{error}</p>}
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button type="button" variant="outline" disabled={pending || !summary} onClick={deny}>Deny</Button>
					<Button type="button" disabled={pending || !summary || password.length === 0} onClick={approve}>{pending ? "Working…" : "Approve connection"}</Button>
				</div>
			</div>
		</AuthShell>
	);
}
