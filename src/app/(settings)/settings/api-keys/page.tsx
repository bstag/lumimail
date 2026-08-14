import Link from "next/link";
import { Bot } from "lucide-react";
import ApiKeysPage from "@/app/(settings)/(org)/api-keys/page";

export default function PersonalApiKeysPage() {
	return (
		<div className="space-y-6">
			<Link href="/settings/mcp" className="flex items-start gap-3 rounded-lg border border-border bg-surface-subtle p-4 hover:border-accent">
				<Bot className="mt-0.5 h-5 w-5 text-accent" aria-hidden="true" />
				<span><span className="block font-semibold text-ink">AI connections</span><span className="mt-1 block text-sm text-ink-muted">Use OAuth-protected MCP with separate read-only and mail-action consent.</span></span>
			</Link>
			<ApiKeysPage />
		</div>
	);
}
