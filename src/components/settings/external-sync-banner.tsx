"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import { useAuthSession } from "@/components/auth/auth-session-context";
import { apiJson } from "@/lib/api/client-response";
import { cn } from "@/lib/utils";
import { describeSyncBanners, type SyncBanner, type SyncBannerAccount } from "./external-sync-banner-utils";

const EXTERNAL_ACCOUNTS_PATH = "/settings/external-accounts";

const toneStyles: Record<SyncBanner["tone"], string> = {
	danger: "border-danger bg-danger-muted text-ink",
	warning: "border-warning bg-warning-muted text-ink",
	info: "border-info bg-info-muted text-ink",
};
const toneIcons = { danger: AlertTriangle, warning: RefreshCw, info: Info } as const;

/**
 * Tells a connection's owner when mail from their connected account is not syncing, whether it is
 * recovering by itself, and when messages could not be imported. It reads the same query as the
 * External accounts page, so the two never disagree and a refresh there updates this too.
 */
export function ExternalSyncBanner() {
	const session = useAuthSession();
	const pathname = usePathname();
	const accounts = useQuery({
		queryKey: ["external-accounts"],
		queryFn: () => apiJson.get<{ accounts: SyncBannerAccount[] }>("/api/external-accounts"),
		enabled: Boolean(session),
		staleTime: 60_000,
		meta: { suppressErrorToast: true },
	});
	if (!session || pathname === EXTERNAL_ACCOUNTS_PATH) return null;
	const banners = describeSyncBanners(accounts.data?.accounts ?? [], session.user.id, new Date());
	if (banners.length === 0) return null;
	return (
		<div className="space-y-2 px-2 pb-2 sm:px-4" data-testid="external-sync-banners">
			{banners.map((banner) => {
				const Icon = toneIcons[banner.tone];
				return (
					<div
						key={banner.key}
						role={banner.tone === "danger" ? "alert" : "status"}
						className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm", toneStyles[banner.tone])}
					>
						<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
						<span className="min-w-0 flex-1">{banner.message}</span>
						<Link href={EXTERNAL_ACCOUNTS_PATH} className="shrink-0 font-medium text-accent underline underline-offset-4">
							View
						</Link>
					</div>
				);
			})}
		</div>
	);
}
