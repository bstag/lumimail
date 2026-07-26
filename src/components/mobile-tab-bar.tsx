"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useMailNavLinks } from "./dashboard-nav";
import { selectMobileTabs } from "./mobile-tab-bar-utils";

/**
 * One-tap access to the folders a phone user lives in.
 *
 * The caller decides whether this exists at all — it is mounted from a media query
 * rather than hidden with `md:hidden`, so that at desktop widths there is no second
 * "Drafts" link in the document. See `use-media-query.ts` for why that matters.
 *
 * `More` opens the same drawer the hamburger did, which is where every destination
 * the bar cannot carry still lives.
 */
export function MobileTabBar({ onOpenMore }: { onOpenMore: () => void }) {
	const t = useTranslations("nav");
	const pathname = usePathname();
	const tabs = selectMobileTabs(useMailNavLinks());

	return (
		<nav
			aria-label={t("mail")}
			className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-surface-raised pb-[env(safe-area-inset-bottom)]"
		>
			{tabs.map((link) => {
				const Icon = link.icon;
				const active = pathname === link.href || pathname?.startsWith(`${link.href}/`);
				return (
					<Link
						key={link.href}
						href={link.href ?? "/inbox"}
						className={cn(
							"relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium text-ink-muted",
							active && "text-accent",
						)}
					>
						{Icon ? <Icon className="h-5 w-5" /> : null}
						<span className="max-w-full truncate px-1">{link.label}</span>
						{typeof link.count === "number" && link.count > 0 && (
							<span aria-hidden className="absolute right-1/4 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
						)}
					</Link>
				);
			})}
			<button
				type="button"
				onClick={onOpenMore}
				className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium text-ink-muted"
			>
				<MoreHorizontal className="h-5 w-5" />
				<span>{t("more")}</span>
			</button>
		</nav>
	);
}
