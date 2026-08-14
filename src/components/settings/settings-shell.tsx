"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
	Building2,
	CloudCog,
	KeyRound,
	Mail,
	RefreshCw,
	ShieldCheck,
	UserRound,
} from "lucide-react";
import { useAuthSession } from "@/components/auth/auth-session-context";
import { cn } from "@/lib/utils";
import {
	getActiveSettingsCategory,
	getSettingsCategories,
	type SettingsCategoryId,
} from "./settings-shell-utils";

const categoryIcons = {
	personal: UserRound,
	mailbox: Mail,
	integrations: KeyRound,
	organization: Building2,
	security: ShieldCheck,
	operations: CloudCog,
	updates: RefreshCw,
} satisfies Record<SettingsCategoryId, typeof UserRound>;

export function SettingsShell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const session = useAuthSession();
	const [hash, setHash] = useState("");

	useEffect(() => {
		function readHash() {
			setHash(globalThis.location.hash);
		}
		readHash();
		globalThis.addEventListener("hashchange", readHash);
		return () => globalThis.removeEventListener("hashchange", readHash);
	}, [pathname]);

	const categories = getSettingsCategories(session?.user.role);
	const active = getActiveSettingsCategory(pathname, hash);

	return (
		<div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold text-ink">Settings</h1>
				<p className="mt-1 text-sm text-ink-muted">Personal preferences and the organization lifecycle in one place.</p>
			</div>
			<div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
				<nav aria-label="Settings categories" className="min-w-0">
					<div className="flex gap-2 overflow-x-auto pb-2 md:sticky md:top-0 md:flex-col md:overflow-visible md:pb-0">
						{categories.map((category) => {
							const Icon = categoryIcons[category.id];
							const selected = active === category.id;
							return (
								<Link
									key={category.id}
									href={category.href}
									aria-current={selected ? "page" : undefined}
									className={cn(
										"flex min-w-48 items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors md:min-w-0",
										selected ? "bg-accent-muted text-ink" : "text-ink-muted hover:bg-surface-subtle hover:text-ink",
									)}
								>
									<Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
									<span className="min-w-0">
										<span className="block text-sm font-medium">{category.label}</span>
										<span className="mt-0.5 block text-xs text-ink-muted">{category.description}</span>
									</span>
								</Link>
							);
						})}
					</div>
				</nav>
				<div className="min-w-0">{children}</div>
			</div>
		</div>
	);
}
