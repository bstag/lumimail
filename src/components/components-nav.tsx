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

export function NavItem({
  link,
  onNavigate,
  collapsed = false,
}: {
  link: NavLink;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
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
    "flex h-9 items-center gap-3 rounded-r-full text-sm font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink",
    active && "bg-accent-muted font-medium text-ink",
    // The primary action is a filled rectangle, so it takes the same 6px corner as
    // every other filled button. It shipped at 16px, which made it the only solid
    // button in the app with its own radius.
    link.primary && "mb-3 h-12 w-fit rounded-[6px] bg-accent px-5 text-white hover:brightness-90",
    // On the rail every item is a centred square, so the pill shape and the negative
    // inset that produce the expanded row are dropped rather than overridden.
    collapsed && "w-10 justify-center gap-0 self-center rounded-[6px] px-0",
    collapsed && link.primary && "h-10 w-10",
  );

  const countLabel = typeof link.count === "number" && link.count > 0
    ? (link.count > 99 ? t("countOverflow") : link.count)
    : null;

  // Collapsed, the label moves into `sr-only` and the count becomes a dot. The name
  // stays in the accessibility tree either way — a rail of unnamed icons is not
  // navigable without sight, and the count is still spoken as part of the name.
  const body = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      <span className={cn("flex-1", collapsed && "sr-only")}>
        {link.label}
        {collapsed && countLabel ? ` (${countLabel})` : null}
      </span>
      {countLabel && !collapsed && (
        <span className="ml-auto mr-3 rounded-full px-2 py-0.5 text-sm font-semibold text-ink-muted">
          {countLabel}
        </span>
      )}
      {countLabel && collapsed && (
        <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
      )}
    </>
  );

  if (link.href === "/compose") {
    return (
      <button
        type="button"
        onClick={() => {
          openComposer();
          onNavigate?.();
        }}
        title={collapsed ? link.label : undefined}
        className={cn("relative", classes)}
      >
        {body}
      </button>
    );
  }

  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      title={collapsed ? link.label : undefined}
      className={cn("relative", collapsed ? classes : cn("-ml-3 pl-6", classes))}
    >
      {body}
    </Link>
  );
}
