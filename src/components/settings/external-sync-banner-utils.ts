export type SyncBannerAccount = {
	id: string;
	provider: "google" | "microsoft";
	externalAddress: string;
	ownerUserId: string;
	status: "connecting" | "initial_sync" | "active" | "paused" | "reconnect_required" |
		"resync_required" | "error" | "disconnected";
	nextRetryAt: string | null;
	autoRetryExhausted: boolean;
	skippedMessageCount?: number;
};

export type SyncBanner = {
	key: string;
	tone: "danger" | "warning" | "info";
	message: string;
};

const providerName = { google: "Google", microsoft: "Microsoft" } as const;
const toneRank = { danger: 0, warning: 1, info: 2 } as const;

function formatRetryTime(date: Date): string {
	return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function statusBanner(
	account: SyncBannerAccount,
	now: Date,
	formatTime: (date: Date) => string,
): SyncBanner | null {
	const address = account.externalAddress;
	if (account.status === "reconnect_required") {
		return {
			key: `${account.id}:reconnect`,
			tone: "danger",
			message: `Reconnect ${address}: ${providerName[account.provider]} could not confirm your access, so new mail is not syncing.`,
		};
	}
	if (account.status !== "error" && account.status !== "resync_required") return null;
	if (account.autoRetryExhausted) {
		return {
			key: `${account.id}:stopped`,
			tone: "danger",
			message: `Sync for ${address} stopped after repeated problems. Retry it from External accounts.`,
		};
	}
	const due = account.nextRetryAt ? new Date(account.nextRetryAt) : null;
	return {
		key: `${account.id}:retry`,
		tone: "warning",
		message: due && due.getTime() > now.getTime()
			? `Sync for ${address} hit a problem. Retrying automatically at ${formatTime(due)}.`
			: `Sync for ${address} hit a problem and is retrying now.`,
	};
}

/**
 * The notices to show the signed-in user about their own connected accounts, most urgent first.
 * Only the connection's owner is told: they are the one who can reconnect it.
 */
export function describeSyncBanners(
	accounts: readonly SyncBannerAccount[],
	userId: string,
	now: Date,
	formatTime: (date: Date) => string = formatRetryTime,
): SyncBanner[] {
	const banners: SyncBanner[] = [];
	for (const account of accounts) {
		if (account.ownerUserId !== userId || account.status === "disconnected") continue;
		const status = statusBanner(account, now, formatTime);
		if (status) banners.push(status);
		const skipped = account.skippedMessageCount ?? 0;
		if (skipped > 0) {
			banners.push({
				key: `${account.id}:skipped`,
				tone: "info",
				message: `${skipped} ${skipped === 1 ? "message" : "messages"} from ${account.externalAddress} could not be imported (too large or repeatedly failing).`,
			});
		}
	}
	return banners.sort((left, right) => toneRank[left.tone] - toneRank[right.tone]);
}
