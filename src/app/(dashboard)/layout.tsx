"use client";

import { useState } from "react";
import Link from "next/link";
import { HelpCircle, Menu, X } from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailSearchInput } from "@/components/mail-search/mail-search-input";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { DashboardNav } from "@/components/dashboard-nav";
import { cn } from "@/lib/utils";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
	const [navOpen, setNavOpen] = useState(false);

	return (
		<AuthGuard requireMailbox>
			<MailboxProvider>
				<ComposeProvider>
					<MailSearchProvider>
						<div className="grid min-h-screen grid-cols-1 bg-surface md:grid-cols-[256px_1fr]">
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
									"fixed inset-y-0 left-0 z-30 flex w-64 flex-col gap-4 bg-surface px-3 py-4 transition-transform md:static md:z-auto md:w-auto md:translate-x-0",
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
								<DashboardNav onNavigate={() => setNavOpen(false)} />
							</aside>
							<div className="flex min-h-screen flex-col">
								<header className="flex h-16 items-center gap-2 px-2 text-sm sm:gap-4 sm:pr-4">
									<button
										type="button"
										aria-label="Open navigation"
										className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle md:hidden"
										onClick={() => setNavOpen(true)}
									>
										<Menu className="h-5 w-5" />
									</button>
									<MailSearchInput />
									<Link
										href="/settings"
										className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle"
									>
										<HelpCircle className="h-5 w-5" />
									</Link>
									<MailboxSelector />
								</header>
								<main className="flex-1 overflow-hidden rounded-tl-3xl bg-surface-raised">{children}</main>
							</div>
							<FloatingComposer />
						</div>
					</MailSearchProvider>
				</ComposeProvider>
			</MailboxProvider>
		</AuthGuard>
	);
}
