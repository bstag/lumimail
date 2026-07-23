import Link from "next/link";
import { KeyRound } from "lucide-react";
import { CurrentMailboxForm } from "@/components/settings/current-mailbox-form";
import { VacationResponderForm } from "@/components/settings/vacation-responder-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
	return (
		<div className="space-y-6 max-w-2xl">
			<CurrentMailboxForm />
			<VacationResponderForm />
			<ChangePasswordForm />
			<section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
				<div className="flex items-center gap-2">
					<KeyRound className="h-5 w-5 text-neutral-600" />
					<h2 className="text-lg font-semibold text-neutral-900">Personal API keys</h2>
				</div>
				<p className="text-sm text-neutral-600">
					Create or revoke your own API keys for mail clients and integrations. A key can use only
					the mailboxes assigned to your account.
				</p>
				<Button asChild variant="outline">
					<Link href="/settings/api-keys">Manage API keys</Link>
				</Button>
			</section>
		</div>
	);
}
