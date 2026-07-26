"use client";

import Link from "next/link";
import {
  Globe2,
  KeyRound,
  Mail,
  Settings,
  Users,
  AtSign,
  Webhook,
  GitBranch,
  Activity,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuthSession } from "@/components/auth/auth-session-context";
import { cn } from "@/lib/utils";
import { NavItem } from "./components-nav";

export function AdminNav({
  className,
  onNavigate,
  collapsed = false,
}: {
  className?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const t = useTranslations("nav");
  const session = useAuthSession();

  const links = [
    { href: "/admin", label: t("overview"), icon: Settings },
    { href: "/members", label: t("members"), icon: Users },
    { href: "/mailboxes", label: t("mailboxes"), icon: Mail },
    { href: "/domains", label: t("domains"), icon: Globe2 },
    { href: "/api-keys", label: t("apiKeys"), icon: KeyRound },
    { href: "/aliases", label: "Aliases", icon: AtSign },
    { href: "/routing", label: "Routing", icon: GitBranch },
    { href: "/webhooks", label: "Webhooks", icon: Webhook },
    ...(session?.user.role === "owner"
      ? [{ href: "/queue-health", label: "Queue health", icon: Activity }]
      : []),
  ];

  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      <Link
        href="/inbox"
        className={cn(
          "mb-3 flex h-10 items-center gap-3 text-ink-muted",
          collapsed ? "justify-center px-0" : "px-3",
        )}
      >
        <img src="/icon-96.png" height={28} width={28} alt="" />
        {/* Hidden rather than dropped: the rail still needs a name for anyone
            navigating it by screen reader or keyboard. */}
        <span className={cn("text-lg font-semibold text-ink", collapsed && "sr-only")}>
          {t("admin")}
        </span>
      </Link>
      {links.map((link) => (
        <NavItem link={link} onNavigate={onNavigate} collapsed={collapsed} key={link.href} />
      ))}
    </nav>
  );
}
