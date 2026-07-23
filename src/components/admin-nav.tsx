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
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { NavItem } from "./components-nav";

export function AdminNav({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const t = useTranslations("nav");

  const links = [
    { href: "/admin", label: t("overview"), icon: Settings },
    { href: "/members", label: t("members"), icon: Users },
    { href: "/mailboxes", label: t("mailboxes"), icon: Mail },
    { href: "/domains", label: t("domains"), icon: Globe2 },
    { href: "/api-keys", label: t("apiKeys"), icon: KeyRound },
    { href: "/aliases", label: "Aliases", icon: AtSign },
    { href: "/routing", label: "Routing", icon: GitBranch },
    { href: "/webhooks", label: "Webhooks", icon: Webhook },
  ];

  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      <Link
        href="/inbox"
        className="mb-3 flex h-10 items-center gap-3 px-3 text-ink-muted"
      >
        <img src="/icon-96.png" height={28} width={28} />
        <span className="text-lg font-semibold text-ink">{t("admin")}</span>
      </Link>
      {links.map((link) => (
        <NavItem link={link} onNavigate={onNavigate} key={link.href} />
      ))}
    </nav>
  );
}
