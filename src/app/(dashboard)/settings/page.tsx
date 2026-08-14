import Link from "next/link";
import { KeyRound } from "lucide-react";
import { CurrentMailboxForm } from "@/components/settings/current-mailbox-form";
import { VacationResponderForm } from "@/components/settings/vacation-responder-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { PersonalSettings } from "@/components/settings/personal-settings";
import { SettingsShell } from "@/components/settings/settings-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
	return (
		<SettingsShell>
			<div className="max-w-2xl space-y-6">
			<section id="personal" className="scroll-mt-6 space-y-4">
				<Card>
					<CardHeader>
						<CardTitle>Personal</CardTitle>
					</CardHeader>
					<CardContent>
						<PersonalSettings />
					</CardContent>
				</Card>
				<ChangePasswordForm />
			</section>
			<section id="mailbox" className="scroll-mt-6 space-y-4">
				<h2 className="text-lg font-semibold text-ink">Mailbox</h2>
				<CurrentMailboxForm embedded />
				<VacationResponderForm />
			</section>
			<section className="space-y-3 rounded-lg border border-border bg-surface-raised p-5">
				<div className="flex items-center gap-2">
					<KeyRound className="h-5 w-5 text-ink-muted" />
					<h2 className="text-lg font-semibold text-ink">Personal API keys</h2>
				</div>
				<p className="text-sm text-ink-muted">
					Create or revoke your own API keys for mail clients and integrations. A key can use only
					the mailboxes assigned to your account.
				</p>
				<Button asChild variant="outline">
					<Link href="/settings/api-keys">Manage API keys</Link>
				</Button>
			</section>
			</div>
		</SettingsShell>
	);
}
