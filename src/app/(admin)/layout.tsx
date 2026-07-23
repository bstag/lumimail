"use client";

import { useState } from "react";
import Link from "next/link";
import { HelpCircle, Menu, Search, X } from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { AdminNav } from "@/components/admin-nav";
import { cn } from "@/lib/utils";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <AuthGuard requireMailbox requireOrgAdmin>
      <MailboxProvider>
        <ComposeProvider>
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
              <AdminNav onNavigate={() => setNavOpen(false)} />
            </aside>
            <div className="flex min-h-screen flex-col">
              <header className="flex h-16 items-center gap-2 px-2 text-sm sm:gap-4 sm:pr-4">
                <button
                  type="button"
                  aria-label="Open navigation"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle md:hidden"
                  onClick={() => setNavOpen(true)}
                >
                  <Menu className="h-5 w-5" />
                </button>
                <div className="flex h-12 flex-1 max-w-3xl items-center gap-3 rounded-full bg-surface-subtle px-4 text-ink-muted">
                  <Search className="h-5 w-5" />
                  <span className="text-[15px]">Search mail</span>
                </div>
                <Link
                  href="/settings"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle"
                >
                  <HelpCircle className="h-5 w-5" />
                </Link>
                <MailboxSelector />
              </header>
              <main className="flex-1 overflow-auto rounded-t-3xl bg-surface-raised px-4 py-6 sm:px-12 sm:py-8 md:w-fit md:min-w-172">
                {children}
              </main>
            </div>
            <FloatingComposer />
          </div>
        </ComposeProvider>
      </MailboxProvider>
    </AuthGuard>
  );
}
