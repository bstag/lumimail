"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authFetch, getClientSessionToken } from "@/lib/auth/client";
import { getHomeActions, heroMessages, sidebarItems } from "./utils";
import { ArrowRight, Inbox, Mail, Search, ShieldCheck } from "lucide-react";

export default function HomePage() {
  const [hasUser, setHasUser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!getClientSessionToken()) return;

    authFetch("/api/auth/me", { redirectOnUnauthorized: false })
      .then((response) => {
        if (!cancelled) setHasUser(response.ok);
      })
      .catch(() => {
        if (!cancelled) setHasUser(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const actions = getHomeActions(hasUser);

  return (
    <div className="min-h-dvh bg-surface text-ink">
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label="Email Platform home"
        >
          <img src="/icon-96.png" height={28} width={28} />
          <span className="text-base font-semibold tracking-tight">
            Lumimail
          </span>
        </Link>

        {/* <nav className="hidden items-center gap-6 text-sm font-medium text-ink-muted md:flex">
					{landingNavItems.map((item) => (
						<a key={item.href} href={item.href} className="transition-colors hover:text-ink">
							{item.label}
						</a>
					))}
				</nav> */}

        <div className="flex items-center gap-2">
          {actions.map((action) => (
            <Button key={action.href} variant={action.variant} asChild>
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ))}
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 pb-12 pt-8 sm:px-6 md:pt-16 lg:grid-cols-[0.86fr_1.14fr] lg:px-8">
          <div className="flex max-w-2xl flex-col justify-center">
            <div className="mb-6 flex w-fit items-center gap-2 text-sm font-medium text-accent">
              <ShieldCheck className="h-4 w-4" />
              Cloudflare-native email operations
            </div>
            <h1 className="max-w-[12ch] text-5xl font-semibold leading-[0.96] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              Mailboxes that feel like your inbox.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-ink-muted">
              Add domains, route inbound mail, send through API keys, and manage
              team mailboxes from one quiet workspace built around the message
              list.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild className="rounded-full px-6">
                <Link href={actions.at(-1)?.href ?? "/register"}>
                  {hasUser ? "Open dashboard" : "Create account"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="rounded-full border-border bg-surface-raised px-6"
              >
                <Link href={hasUser ? "/inbox" : "/login"}>
                  {hasUser ? "View inbox" : "Log in"}
                </Link>
              </Button>
            </div>
          </div>

          <div className="relative min-h-[520px] overflow-hidden rounded-[2rem] border border-border bg-surface-raised shadow-[0_24px_70px_-45px_rgba(30,64,175,0.55)]">
            <div className="grid h-full min-h-[520px] grid-cols-[176px_1fr] bg-surface-raised">
              <aside className="hidden flex-col gap-2 bg-surface px-3 py-5 sm:flex">
                <div className="mb-4 flex items-center gap-3 px-3 text-ink-muted">
                  <Inbox className="h-5 w-5" />
                  <span className="font-semibold">Mail</span>
                </div>
                <div className="mb-3 flex h-12 w-fit items-center gap-2 rounded-2xl bg-accent-muted px-5 text-sm font-semibold text-accent shadow-sm">
                  <Mail className="h-4 w-4" />
                  Compose
                </div>
                {sidebarItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className={`flex h-9 items-center justify-between rounded-r-full px-3 text-sm font-medium ${
                        item.active
                          ? "bg-accent-muted text-accent"
                          : "text-ink-muted"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </span>
                      {item.count && (
                        <span className="text-xs text-accent">
                          {item.count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </aside>

              <div className="col-span-2 flex min-w-0 flex-col sm:col-span-1">
                <div className="flex h-16 items-center gap-3 bg-surface px-4">
                  <div className="flex h-12 flex-1 items-center gap-3 rounded-full bg-surface-subtle px-4 text-ink-muted">
                    <Search className="h-5 w-5" />
                    <span className="text-[15px]">Search mail</span>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                    <Mail className="h-4 w-4" />
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-tl-3xl bg-surface-raised">
                  <div className="flex h-14 items-center justify-between border-b border-border px-6">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-medium text-ink">
                        Priority inbox
                      </h2>
                      <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-ink-muted">
                        18
                      </span>
                    </div>
                    <span className="hidden text-sm font-medium text-ink-muted md:inline">
                      Updated 2 min ago
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {heroMessages.map((message) => (
                      <div
                        key={message.sender}
                        className="grid min-h-14 grid-cols-[28px_minmax(112px,180px)_1fr_auto] items-center gap-3 px-5 text-sm hover:bg-surface-subtle"
                      >
                        <message.icon className="h-4 w-4 text-ink-faint" />
                        <span className="truncate font-semibold text-ink">
                          {message.sender}
                        </span>
                        <span className="truncate text-ink-muted">
                          <span className="font-medium text-ink">
                            {message.subject}
                          </span>
                          <span className="hidden text-ink-muted md:inline">
                            {" "}
                            - {message.preview}
                          </span>
                        </span>
                        <span className="rounded-full bg-accent-muted px-2.5 py-1 text-xs font-semibold text-accent">
                          {message.badge}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
