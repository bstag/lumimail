import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import { useCompose } from "./compose/compose-context";

export type NavLink = {
	href?: string;
	label?: string;
	icon?: LucideIcon;
	primary?: boolean;
	count?: number;
	break?: boolean;
};

export function NavItem({ link, onNavigate }: { link: NavLink; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { openComposer } = useCompose();

  if (!link.href) {
    return <span className="flex-1" />;
  }

  const Icon = link.icon;
  if (!Icon) return <span className="flex-1" />;
  const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
  const classes = cn(
    "flex h-9 items-center gap-3 rounded-r-full text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink)]",
    active && "bg-[var(--accent-muted)] text-[var(--ink)] font-medium",
    link.primary &&
      "mb-3 h-12 w-fit rounded-2xl bg-[var(--accent)] px-5 text-white hover:brightness-90",
  );

  const countLabel = typeof link.count === "number" && link.count > 0
    ? (link.count > 99 ? t("countOverflow") : link.count)
    : null;

  if (link.href === "/compose") {
    return (
      <button
        type="button"
        onClick={() => {
          openComposer();
          onNavigate?.();
        }}
        className={classes}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1">{link.label}</span>
        {countLabel && (
          <span className="ml-auto mr-3 rounded-full px-2 py-0.5 text-sm font-semibold text-ink-muted">
            {countLabel}
          </span>
        )}
      </button>
    );
  }

  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      className={cn("-ml-3 pl-6", classes)}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{link.label}</span>
      {countLabel && (
        <span className="ml-auto mr-3 rounded-full px-2 py-0.5 text-sm font-semibold text-ink-muted">
          {countLabel}
        </span>
      )}
    </Link>
  );
}
