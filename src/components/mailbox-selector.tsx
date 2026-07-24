"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, LogOut, Mail, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuthSession } from "@/components/auth/auth-session-context";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { authFetch, clearClientSessionToken } from "@/lib/auth/client";
import { isOrganizationAdminRole } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

export function MailboxSelector() {
	const t = useTranslations("nav");
	const session = useAuthSession();
	const canAdministerOrganization = isOrganizationAdminRole(session?.user?.role);
	const { selectedMailbox, setSelectedMailbox, mailboxes, isLoading } =
		useSelectedMailbox();
	const pathname = usePathname();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const { counts } = useMessageCounts(null, open);

	useEffect(() => {
		function onPointerDown(event: PointerEvent) {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		}

		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, []);

	if (isLoading) return null;

	const selectedName = selectedMailbox?.displayName ?? selectedMailbox?.localPart ?? t("allMailboxes");
	const selectedEmail = selectedMailbox
		? `${selectedMailbox.localPart}@${selectedMailbox.hostname}`
		: t("allDomains");
	const adminActive =
		pathname === "/admin" ||
		pathname.startsWith("/mailboxes") ||
		pathname.startsWith("/domains") ||
		pathname.startsWith("/routing") ||
		pathname.startsWith("/api-keys") ||
		pathname.startsWith("/webhooks");

	async function logout() {
		await authFetch("/api/auth/logout", { method: "POST", redirectOnUnauthorized: false });
		clearClientSessionToken();
		setOpen(false);
		router.push("/login");
	}

	return (
		<div ref={ref} className="relative shrink-0">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex items-center justify-between gap-3 rounded-full p-1 text-left hover:bg-surface-subtle sm:py-1.5 sm:pr-2 sm:pl-4"
			>
				<div className="flex min-w-0 items-center gap-3">
					<div className="hidden min-w-0 text-right flex-col justify-center sm:flex">
						<p className="truncate text-sm font-medium text-ink">{selectedName}</p>
						<p className="truncate text-[11px] text-ink-muted">{selectedEmail}</p>
					</div>
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
						<Mail className="h-4 w-4" />
					</div>
				</div>
			</button>
			{open && (
				<div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-border bg-surface-raised py-2 shadow-xl">
					<div className="px-4 pt-3 pb-2">
						<p className="text-sm font-medium text-ink">{t("mailboxes")}</p>
						<p className="text-xs text-ink-muted">{t("chooseMailbox")}</p>
					</div>
					{mailboxes.map((mb) => {
						const email = `${mb.localPart}@${mb.hostname}`;
						const name = mb.displayName ?? mb.localPart;
						const active = !adminActive && selectedMailbox?.id === mb.id;
						const mailboxCount = counts.mailboxes.find((count) => count.mailboxId === mb.id);
						const unread = mailboxCount?.unread ?? 0;
						const inbox = mailboxCount?.inbox ?? 0;

						return (
							<button
								key={mb.id}
								type="button"
								onClick={() => {
									setSelectedMailbox(mb);
									setOpen(false);
									router.push("/inbox");
								}}
								className={cn(
									"flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-subtle",
									active && "bg-accent-muted",
								)}
							>
								<div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-muted text-accent">
									{name.slice(0, 1).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<p className="truncate text-sm font-medium text-ink">{name}</p>
										{mb.isPrimary && (
											<span className="rounded-full bg-accent-muted px-2 py-0.5 text-[10px] font-medium text-accent">
												{t("primary")}
											</span>
										)}
									</div>
									<p className="truncate text-xs text-ink-muted">
										{email}
										{inbox > 0 && ` · ${inbox} ${t("inbox").toLowerCase()}`}
									</p>
								</div>
								{unread > 0 && (
									<span className="rounded-full bg-accent-muted px-2 py-0.5 text-[11px] font-semibold text-accent">
										{unread > 99 ? t("countOverflow") : unread}
									</span>
								)}
								{active && <Check className="h-4 w-4 text-accent" />}
							</button>
						);
					})}
					<div className="mt-2 border-t divide-y divide-border border-border pt-2">
						{canAdministerOrganization && (
							<Link
								href="/admin"
								onClick={() => setOpen(false)}
								className={cn(
									"flex items-center gap-3 px-4 py-3 text-sm font-medium text-ink-muted hover:bg-surface-subtle",
									adminActive && "bg-accent-muted",
								)}
							>
								<div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-subtle text-ink-muted">
									<Settings className="h-4 w-4" />
								</div>
								<div>
									<p className="text-sm font-medium text-ink">{t("adminSettings")}</p>
									<p className="text-xs text-ink-muted">{t("adminSettingsDesc")}</p>
								</div>
								{adminActive && <Check className="ml-auto h-4 w-4 text-accent" />}
							</Link>
						)}
						<button
							type="button"
							onClick={logout}
							className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-danger hover:bg-danger-muted"
						>
							<div className="flex h-9 w-9 items-center justify-center rounded-full bg-danger-muted text-danger">
								<LogOut className="h-4 w-4" />
							</div>
							<div>
								<p className="text-sm font-medium">{t("logOut")}</p>
								<p className="text-xs text-danger/80">{t("signOutSession")}</p>
							</div>
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
