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
import { NavItem } from "./components-nav";
import { getFolderNavCount } from "./dashboard-nav-utils";

export function DashboardNav({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const { selectedMailbox, mailboxes, isLoading } = useSelectedMailbox();
  const canSend = Boolean(findSendCapableMailbox(mailboxes));
  const { counts } = useMessageCounts(selectedMailbox?.id, !isLoading);

  const links = [
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
  const linksWithCounts = links
    .filter((link) => canSend || (link.href !== "/compose" && link.href !== "/drafts"))
    .map((link) => {
    if (link.href === "/inbox") return { ...link, count: getFolderNavCount("inbox", counts.folders) };
    if (link.href === "/spam") return { ...link, count: getFolderNavCount("spam", counts.folders) };
    return link;
    });

  return (
    <nav className={cn("flex flex-col gap-1 flex-1", className)}>
      <Link
        href="/inbox"
        className="mb-3 flex h-10 items-center gap-3 px-3 text-ink-muted"
      >
        <img src="/icon-96.png" height={28} width={28} />
        <span className="text-lg font-semibold text-ink">{t("mail")}</span>
      </Link>
      {linksWithCounts.map((link, i) => (
        <NavItem link={link} onNavigate={onNavigate} key={`nav-${link.href || i}`} />
      ))}
    </nav>
  );
}
