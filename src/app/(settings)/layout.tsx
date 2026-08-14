"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SettingsNav } from "@/components/settings/settings-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import {
	readSidebarCollapsed,
	sidebarGridColumns,
	writeSidebarCollapsed,
} from "@/components/nav-sidebar-utils";
import { MOBILE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/**
 * The one shell for the whole settings area — personal preferences and
 * organization administration share this chrome, so moving between them never
 * swaps frames. Same sidebar mechanics and content bounds as the mail shell;
 * organization routes add their guard in the nested `(org)` layout.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
	const [navOpen, setNavOpen] = useState(false);
	const [collapsed, setCollapsed] = useState(false);
	const isMobile = useMediaQuery(MOBILE_QUERY);

	// Read after mount rather than from a pre-paint script: `AuthGuard` renders
	// nothing until the session resolves, so the shell has not painted yet.
	useEffect(() => {
		setCollapsed(readSidebarCollapsed(globalThis.localStorage));
	}, []);

	function toggleCollapsed() {
		setCollapsed((previous) => {
			const next = !previous;
			writeSidebarCollapsed(globalThis.localStorage, next);
			return next;
		});
	}

	return (
		<AuthGuard requireMailbox>
			<MailboxProvider>
				<div
					className="grid min-h-screen grid-cols-1 bg-surface md:[grid-template-columns:var(--nav-cols)]"
					style={{ "--nav-cols": sidebarGridColumns(collapsed) } as React.CSSProperties}
				>
					{navOpen && (
						<button
							type="button"
							aria-label="Close navigation"
							className="fixed inset-0 z-20 bg-black/40 md:hidden"
							onClick={() => setNavOpen(false)}
						/>
					)}
					<aside
						className={cn(
							"fixed inset-y-0 left-0 z-30 flex w-64 flex-col gap-4 overflow-y-auto bg-surface py-4 transition-transform md:static md:z-auto md:w-auto md:translate-x-0",
							collapsed ? "px-2" : "px-3",
							navOpen ? "translate-x-0" : "-translate-x-full",
						)}
					>
						<button
							type="button"
							aria-label="Close navigation"
							className="flex h-9 w-9 items-center justify-center self-end rounded-full text-ink-muted hover:bg-surface-subtle md:hidden"
							onClick={() => setNavOpen(false)}
						>
							<X className="h-5 w-5" />
						</button>
						<Link
							href="/inbox"
							className={cn(
								"flex h-10 items-center gap-3 text-ink-muted",
								collapsed ? "justify-center px-0" : "px-3",
							)}
						>
							<img src="/icon-96.png" height={28} width={28} alt="" />
							{/* Hidden rather than dropped: the rail still needs a name for anyone
							    navigating it by screen reader or keyboard. */}
							<span className={cn("text-lg font-semibold text-ink", collapsed && "sr-only")}>
								Settings
							</span>
						</Link>
						{/* The drawer is always the full nav: a rail is a desktop affordance. */}
						<SettingsNav onNavigate={() => setNavOpen(false)} collapsed={collapsed && !isMobile} />
					</aside>
					<div className="flex min-h-screen min-w-0 flex-col">
						<header className="flex h-16 items-center gap-2 px-2 text-sm sm:gap-4 sm:pr-4">
							{/* One slot, two jobs: opens the drawer on a phone, collapses the
							    sidebar it sits beside on a desktop. */}
							<button
								type="button"
								aria-label="Open navigation"
								className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle md:hidden"
								onClick={() => setNavOpen(true)}
							>
								<Menu className="h-5 w-5" />
							</button>
							<button
								type="button"
								aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
								aria-expanded={!collapsed}
								className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle md:flex"
								onClick={toggleCollapsed}
							>
								{collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
							</button>
							<Link
								href="/inbox"
								aria-label="Back to mail"
								className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle"
							>
								<ArrowLeft className="h-5 w-5" />
							</Link>
							<span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
								Settings
							</span>
							<LanguageSwitcher />
							<ThemeToggle />
							<MailboxSelector />
						</header>
						{/*
						  The content column is bounded here rather than per page, matching the
						  mail shell, so the frame never shifts as you navigate the section.
						*/}
						<main className="min-w-0 flex-1 overflow-auto rounded-t-3xl bg-surface-raised px-4 py-6 sm:px-12 sm:py-8">
							<div className="mx-auto w-full max-w-5xl">{children}</div>
						</main>
					</div>
				</div>
			</MailboxProvider>
		</AuthGuard>
	);
}
