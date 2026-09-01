"use client";

import Link from "next/link";
import {
  Archive,
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
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { findSendCapableMailbox } from "@/components/mailbox-provider-utils";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { apiJson } from "@/lib/api/client-response";
import { buildLabelTree, type LabelRecord } from "@/lib/labels-tree";
import { labelKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { BrandLockup } from "@/components/brand";
import { NavItem, type NavLink } from "./components-nav";
import { getFolderNavCount } from "./dashboard-nav-utils";

async function fetchNavLabels(): Promise<LabelRecord[]> {
	// Tolerates the legacy `{ labels: [] }` shape some clients still mock.
	const data = await apiJson.get<unknown>("/api/labels");
	return Array.isArray(data) ? (data as LabelRecord[]) : [];
}

/**
 * The user's labels as browse destinations (F75), rendered beneath the Labels
 * nav entry that manages them.
 *
 * Hidden on the collapsed rail: a label has a colour, not an icon, so a rail of
 * unnamed dots would not be navigable. The Labels entry itself stays on the rail,
 * so management remains reachable in both states.
 */
function LabelNavTree({ onNavigate }: { onNavigate?: () => void }) {
	const pathname = usePathname();
	const { data: labels = [] } = useQuery({ queryKey: labelKeys.all, queryFn: fetchNavLabels });
	const tree = buildLabelTree(labels);

	if (tree.length === 0) return null;

	function labelLink(label: LabelRecord, nested: boolean) {
		const href = `/label/${label.id}`;
		return (
			<Link
				key={label.id}
				href={href}
				onClick={onNavigate}
				className={cn(
					"-ml-3 flex h-8 items-center gap-2 rounded-r-full text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink",
					// One padding utility, picked here rather than layered: `ps-6` and
					// `ps-11` set the same property, so both in the class list would
					// leave the winner to stylesheet order. Logical (`ps-`) so Arabic
					// nests from the right.
					nested ? "ps-12" : "ps-6",
					pathname === href && "bg-accent-muted font-medium text-ink",
				)}
			>
				<span
					aria-hidden
					className="h-2 w-2 shrink-0 rounded-full"
					style={{ backgroundColor: label.color }}
				/>
				<span className="truncate">{label.name}</span>
			</Link>
		);
	}

	return (
		<div className="flex flex-col">
			{tree.map((node) => (
				<div key={node.id} className="flex flex-col">
					{labelLink(node, false)}
					{node.children.map((child) => labelLink(child, true))}
				</div>
			))}
		</div>
	);
}

/**
 * The mail destinations this user actually has, with unread counts applied.
 *
 * Shared with the mobile bottom bar so the two cannot disagree about what a viewer is
 * allowed to see. The bar picks from whatever this returns rather than from its own
 * list — see `mobile-tab-bar-utils.ts`.
 */
export function useMailNavLinks(): NavLink[] {
  const t = useTranslations("nav");
  const { scopedMailboxId, mailboxes, isLoading } = useSelectedMailbox();
  const canSend = Boolean(findSendCapableMailbox(mailboxes));
  // Follows the list scope, so the badge counts what the folder will show.
  const { counts } = useMessageCounts(scopedMailboxId, !isLoading);

  const links: NavLink[] = [
    { href: "/compose", label: t("compose"), icon: MailPlus, primary: true },
    { href: "/inbox", label: t("inbox"), icon: Inbox },
    { href: "/sent", label: t("sent"), icon: Send },
    { href: "/drafts", label: t("drafts"), icon: FileText },
    { href: "/starred", label: t("starred"), icon: Star },
    { href: "/archive", label: t("archive"), icon: Archive },
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
        <BrandLockup
          className="gap-3"
          markClassName="h-7 w-7"
          wordmarkClassName={cn("text-lg", collapsed && "sr-only")}
        />
      </Link>
      {links.map((link, i) => (
        <Fragment key={`nav-${link.href || i}`}>
          <NavItem link={link} onNavigate={onNavigate} collapsed={collapsed} />
          {link.href === "/labels" && !collapsed && <LabelNavTree onNavigate={onNavigate} />}
        </Fragment>
      ))}
    </nav>
  );
}
