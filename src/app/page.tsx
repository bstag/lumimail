"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { authFetch, clearLegacySessionToken } from "@/lib/auth/client";
import { getHomeActions, heroMessages, sidebarItems } from "./utils";
import { ArrowRight, Inbox, Mail, Search, ShieldCheck } from "lucide-react";

export default function HomePage() {
  const t = useTranslations("landing");
  const tNav = useTranslations("nav");
  const [hasUser, setHasUser] = useState(false);

  useEffect(() => {
    let cancelled = false;
    clearLegacySessionToken();

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
          aria-label={t("homeAria")}
        >
          <img src="/icon-96.png" height={28} width={28} alt="" className="shrink-0" />
          <span className="hidden text-base font-semibold tracking-tight min-[360px]:inline">
            Picket
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          {/* Hidden on a phone, where these two buttons pushed the header past the
              viewport and clipped "Create account". Nothing is lost: the hero repeats
              both actions immediately below, at full width. */}
          <div className="hidden items-center gap-2 sm:flex">
            {actions.map((action) => (
              <Button key={action.href} variant={action.variant} asChild className="px-4 sm:px-6">
                <Link href={action.href}>{t(action.labelKey)}</Link>
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 pb-12 pt-8 sm:px-6 md:pt-16 lg:grid-cols-[0.86fr_1.14fr] lg:px-8">
          <div className="flex max-w-2xl flex-col justify-center">
            <div className="mb-6 flex w-fit items-center gap-2 text-sm font-medium text-accent">
              <ShieldCheck className="h-4 w-4" />
              {t("badge")}
            </div>
            <h1 className="max-w-[12ch] text-5xl font-semibold leading-[0.96] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              {t("heading")}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-ink-muted">
              {t("description")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild className="rounded-full px-6">
                <Link href={actions.at(-1)?.href ?? "/register"}>
                  {hasUser ? t("openDashboard") : t("createAccount")}
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
                  {hasUser ? t("viewInbox") : t("logIn")}
                </Link>
              </Button>
            </div>
          </div>

          <div className="relative min-h-[520px] overflow-hidden rounded-[2rem] border border-border bg-surface-raised shadow-[0_24px_70px_-45px_rgba(30,64,175,0.55)]">
            <div className="grid h-full min-h-[520px] grid-cols-[176px_1fr] bg-surface-raised">
              <aside className="hidden flex-col gap-2 bg-surface px-3 py-5 sm:flex">
                <div className="mb-4 flex items-center gap-3 px-3 text-ink-muted">
                  <Inbox className="h-5 w-5" />
                  <span className="font-semibold">{t("mail")}</span>
                </div>
                <div className="mb-3 flex h-12 w-fit items-center gap-2 rounded-2xl bg-accent-muted px-5 text-sm font-semibold text-accent shadow-sm">
                  <Mail className="h-4 w-4" />
                  {t("compose")}
                </div>
                {sidebarItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.labelKey}
                      className={`flex h-9 items-center justify-between rounded-r-full px-3 text-sm font-medium ${
                        item.active
                          ? "bg-accent-muted text-accent"
                          : "text-ink-muted"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="h-4 w-4" />
                        {tNav(item.labelKey)}
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
                    <span className="text-[15px]">{t("searchPlaceholder")}</span>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                    <Mail className="h-4 w-4" />
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-tl-3xl bg-surface-raised">
                  <div className="flex h-14 items-center justify-between border-b border-border px-6">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-medium text-ink">
                        {t("priorityInbox")}
                      </h2>
                      <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-ink-muted">
                        18
                      </span>
                    </div>
                    <span className="hidden text-sm font-medium text-ink-muted md:inline">
                      {t("updatedAgo")}
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

        <section className="mx-auto grid max-w-7xl gap-4 px-4 pb-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
          {(["Delivery", "Collab", "Flow", "Clients"] as const).map((feature) => (
            <article key={feature} className="rounded-2xl border border-border bg-surface-raised p-5">
              <h2 className="font-semibold text-ink">{t(`feature${feature}Title`)}</h2>
              <p className="mt-2 text-sm leading-6 text-ink-muted">{t(`feature${feature}Desc`)}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
