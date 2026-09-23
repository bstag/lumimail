import { Suspense } from "react";
import { ExternalAccountsClient } from "./external-accounts-client";

export default function ExternalAccountsPage() {
	return (
		<Suspense fallback={<p className="text-sm text-ink-muted">Loading...</p>}>
			<ExternalAccountsClient />
		</Suspense>
	);
}
