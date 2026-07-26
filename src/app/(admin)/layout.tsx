"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HelpCircle, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { AdminNav } from "@/components/admin-nav";
import {
  readSidebarCollapsed,
  sidebarGridColumns,
  writeSidebarCollapsed,
} from "@/components/nav-sidebar-utils";
import { MOBILE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useMediaQuery(MOBILE_QUERY);

  // Read after mount rather than from a pre-paint script: `AuthGuard` renders nothing
  // until the session resolves, so the shell has not painted yet.
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
    <AuthGuard requireMailbox requireOrgAdmin>
      <MailboxProvider>
        <ComposeProvider>
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
                "fixed inset-y-0 left-0 z-30 flex w-64 flex-col gap-4 bg-surface py-4 transition-transform md:static md:z-auto md:w-auto md:translate-x-0",
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
              {/* The drawer is always the full nav: a rail is a desktop affordance. */}
              <AdminNav onNavigate={() => setNavOpen(false)} collapsed={collapsed && !isMobile} />
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
                <div className="flex h-12 min-w-0 flex-1 max-w-3xl items-center gap-3 rounded-full bg-surface-subtle px-4 text-ink-muted">
                  <Search className="h-5 w-5 shrink-0" />
                  <span className="truncate text-[15px]">Search mail</span>
                </div>
                <Link
                  href="/settings"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle"
                >
                  <HelpCircle className="h-5 w-5" />
                </Link>
                <MailboxSelector />
              </header>
              {/*
                The content column is bounded here rather than per page. Pages used to
                pick their own `max-w-*`, so content right edges landed at 1232, 1072,
                and 976 across the section and the frame shifted as you navigated.
              */}
              <main className="min-w-0 flex-1 overflow-auto rounded-t-3xl bg-surface-raised px-4 py-6 sm:px-12 sm:py-8">
                <div className="mx-auto w-full max-w-5xl">{children}</div>
              </main>
            </div>
            <FloatingComposer />
          </div>
        </ComposeProvider>
      </MailboxProvider>
    </AuthGuard>
  );
}
