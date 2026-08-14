"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
	Activity,
	AtSign,
	Building2,
	Gauge,
	GitBranch,
	Globe2,
	KeyRound,
	LayoutGrid,
	Mail,
	ShieldCheck,
	UserRound,
	Users,
	Webhook,
} from "lucide-react";
import { useAuthSession } from "@/components/auth/auth-session-context";
import { cn } from "@/lib/utils";
import {
	getActiveSettingsNavItem,
	getSettingsNavSections,
	type SettingsNavItemId,
} from "./settings-nav-utils";

const itemIcons = {
	personal: UserRound,
	mailbox: Mail,
	integrations: KeyRound,
	overview: Building2,
	members: Users,
	mailboxes: LayoutGrid,
	domains: Globe2,
	aliases: AtSign,
	routing: GitBranch,
	webhooks: Webhook,
	"org-api-keys": ShieldCheck,
	operations: Gauge,
	"queue-health": Activity,
} satisfies Record<SettingsNavItemId, typeof UserRound>;

/**
 * The single navigation for the unified settings shell: personal and
 * administrative destinations in one role-filtered list, in the same visual
 * language as the mail sidebar so the two shells read as one application.
 */
export function SettingsNav({
	onNavigate,
	collapsed = false,
}: {
	onNavigate?: () => void;
	collapsed?: boolean;
}) {
	const pathname = usePathname();
	const session = useAuthSession();
	const [hash, setHash] = useState("");

	// Personal and Mailbox share `/settings`, so the selected item follows the
	// fragment as well as the path.
	useEffect(() => {
		function readHash() {
			setHash(globalThis.location.hash);
		}
		readHash();
		globalThis.addEventListener("hashchange", readHash);
		return () => globalThis.removeEventListener("hashchange", readHash);
	}, [pathname]);

	const sections = getSettingsNavSections(session?.user.role);
	const active = getActiveSettingsNavItem(pathname, hash);

	return (
		<nav aria-label="Settings" className="flex flex-col gap-1">
			{sections.map((section, index) => (
				<div key={section.id} className="flex flex-col gap-1">
					{collapsed ? (
						index > 0 && <div aria-hidden className="mx-2 my-2 border-t border-border" />
					) : (
						<p
							className={cn(
								"px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted",
								index > 0 ? "pt-4" : "pt-1",
							)}
						>
							{section.label}
						</p>
					)}
					{section.items.map((item) => {
						const Icon = itemIcons[item.id];
						const selected = active === item.id;
						return (
							<Link
								key={item.id}
								href={item.href}
								onClick={onNavigate}
								aria-current={selected ? "page" : undefined}
								title={collapsed ? item.label : undefined}
								className={cn(
									"flex h-9 items-center gap-3 rounded-r-full text-sm font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink",
									selected && "bg-accent-muted text-ink",
									collapsed
										? "w-10 justify-center gap-0 self-center rounded-[6px] px-0"
										: "-ml-3 pl-6",
								)}
							>
								<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
								<span className={cn(collapsed && "sr-only")}>{item.label}</span>
							</Link>
						);
					})}
				</div>
			))}
		</nav>
	);
}
