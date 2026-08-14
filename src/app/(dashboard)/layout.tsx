"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen, Settings, X } from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailSearchInput } from "@/components/mail-search/mail-search-input";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { DashboardNav } from "@/components/dashboard-nav";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import {
	readSidebarCollapsed,
	sidebarGridColumns,
	writeSidebarCollapsed,
} from "@/components/nav-sidebar-utils";
import { MOBILE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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
				<ComposeProvider>
					<MailSearchProvider>
						<div
							className="grid min-h-screen grid-cols-1 bg-surface md:[grid-template-columns:var(--nav-cols)]"
							style={{ "--nav-cols": sidebarGridColumns(collapsed) } as React.CSSProperties}
						>
							{navOpen && (
								<button
									type="button"
									aria-label="Close navigation"
									className="fixed inset-0 z-40 bg-black/40 md:hidden"
									onClick={() => setNavOpen(false)}
								/>
							)}
							<aside
								className={cn(
									"fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-4 bg-surface py-4 transition-transform md:static md:z-auto md:w-auto md:translate-x-0",
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
								{/* The drawer is always the full nav: a rail is a desktop affordance,
								    and collapsing a sheet the user just opened would be perverse. */}
								<DashboardNav
									onNavigate={() => setNavOpen(false)}
									collapsed={collapsed && !isMobile}
								/>
							</aside>
							<div className="flex min-h-screen min-w-0 flex-col">
								<header className="flex h-16 items-center gap-2 px-2 text-sm sm:gap-4 sm:pr-4">
									{/* Desktop only. On a phone the tab bar's More button is the way into
									    the drawer, so a hamburger here would be a second control for the
									    same thing, competing for width on a 390px header. */}
									{!isMobile && (
										<button
											type="button"
											aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
											aria-expanded={!collapsed}
											className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle md:flex"
											onClick={toggleCollapsed}
										>
											{collapsed ? (
												<PanelLeftOpen className="h-5 w-5" />
											) : (
												<PanelLeftClose className="h-5 w-5" />
											)}
										</button>
									)}
									<MailSearchInput />
									<LanguageSwitcher />
									<ThemeToggle />
									<Link
										href="/settings"
										aria-label="Settings"
										className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle"
									>
										<Settings className="h-5 w-5" />
									</Link>
									<MailboxSelector />
								</header>
								{/* Rounded on both top corners, matching the admin shell. The mail panes are
									    deliberately full-bleed — that is why this one has no padding — but the
									    container itself should not change shape when you switch sections.
									    The bottom padding keeps the last row clear of the tab bar. */}
								<main
									className={cn(
										"flex-1 overflow-hidden rounded-t-3xl bg-surface-raised",
										isMobile && "pb-[calc(4rem+env(safe-area-inset-bottom))]",
									)}
								>
									{children}
								</main>
							</div>
							<FloatingComposer />
							{isMobile && <MobileTabBar onOpenMore={() => setNavOpen(true)} />}
						</div>
					</MailSearchProvider>
				</ComposeProvider>
			</MailboxProvider>
		</AuthGuard>
	);
}
