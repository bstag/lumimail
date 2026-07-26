"use client";

import Link from "next/link";
import {
  FileText,
  Filter,
  Inbox,
  MailPlus,
  Send,
  Settings,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { findSendCapableMailbox } from "@/components/mailbox-provider-utils";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { cn } from "@/lib/utils";
import { NavItem, type NavLink } from "./components-nav";
import { getFolderNavCount } from "./dashboard-nav-utils";

/**
 * The mail destinations this user actually has, with unread counts applied.
 *
 * Shared with the mobile bottom bar so the two cannot disagree about what a viewer is
 * allowed to see. The bar picks from whatever this returns rather than from its own
 * list — see `mobile-tab-bar-utils.ts`.
 */
export function useMailNavLinks(): NavLink[] {
  const t = useTranslations("nav");
  const { selectedMailbox, mailboxes, isLoading } = useSelectedMailbox();
  const canSend = Boolean(findSendCapableMailbox(mailboxes));
  const { counts } = useMessageCounts(selectedMailbox?.id, !isLoading);

  const links: NavLink[] = [
    { href: "/compose", label: t("compose"), icon: MailPlus, primary: true },
    { href: "/inbox", label: t("inbox"), icon: Inbox },
    { href: "/sent", label: t("sent"), icon: Send },
    { href: "/drafts", label: t("drafts"), icon: FileText },
    { href: "/starred", label: t("starred"), icon: Star },
    { href: "/spam", label: t("spam"), icon: ShieldAlert },
    { href: "/trash", label: t("trash"), icon: Trash2 },
    { href: "/labels", label: t("labels"), icon: Tag },
    { href: "/contacts", label: t("contacts"), icon: Users },
    { href: "/filters", label: t("filters"), icon: Filter },
    { break: true },
    { href: "/settings", label: t("settings"), icon: Settings },
  ];

  return links
    .filter((link) => canSend || (link.href !== "/compose" && link.href !== "/drafts"))
    .map((link) => {
      if (link.href === "/inbox") return { ...link, count: getFolderNavCount("inbox", counts.folders) };
      if (link.href === "/spam") return { ...link, count: getFolderNavCount("spam", counts.folders) };
      return link;
    });
}

export function DashboardNav({
  className,
  onNavigate,
  collapsed = false,
}: {
  className?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const t = useTranslations("nav");
  const links = useMailNavLinks();

  return (
    <nav className={cn("flex flex-1 flex-col gap-1", className)}>
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
          {t("mail")}
        </span>
      </Link>
      {links.map((link, i) => (
        <NavItem link={link} onNavigate={onNavigate} collapsed={collapsed} key={`nav-${link.href || i}`} />
      ))}
    </nav>
  );
}
