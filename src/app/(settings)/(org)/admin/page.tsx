"use client";

import Link from "next/link";
import {
	Activity,
	AtSign,
	Gauge,
	GitBranch,
	Globe2,
	KeyRound,
	Mail,
	Users,
	Webhook,
} from "lucide-react";
import { useAuthSession } from "@/components/auth/auth-session-context";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export default function AdminSettingsPage() {
	const t = useTranslations("admin");
	const tNav = useTranslations("nav");
	const session = useAuthSession();

	const sections = [
		{ href: "/members", title: tNav("members"), description: "Invite people and manage roles and access.", icon: Users },
		{ href: "/mailboxes", title: t("mailboxesCard"), description: t("mailboxesDesc"), icon: Mail },
		{ href: "/domains", title: t("domainsCard"), description: t("domainsDesc"), icon: Globe2 },
		{ href: "/aliases", title: "Aliases", description: "Point extra addresses and groups at mailboxes.", icon: AtSign },
		{ href: "/routing", title: "Routing", description: "Route inbound mail with rules and catch-alls.", icon: GitBranch },
		{ href: "/webhooks", title: t("webhooksCard"), description: t("webhooksDesc"), icon: Webhook },
		{ href: "/api-keys", title: t("apiKeysCard"), description: t("apiKeysDesc"), icon: KeyRound },
		...(session?.user.role === "owner"
			? [{
				href: "/operations",
				title: "Operations",
				description: "Review read-only platform health and integrity evidence.",
				icon: Gauge,
			}, {
				href: "/queue-health",
				title: t("queueHealthTitle"),
				description: t("queueHealthCardDesc"),
				icon: Activity,
			}]
			: []),
	];

	return (
		<div className="h-full overflow-auto">
			<PageHeader
				title="Organization"
				description="Everything this workspace runs on: people, mailboxes, domains, and delivery."
				className="mb-8"
			/>
			<div className="grid gap-4 md:grid-cols-2">
				{sections.map((section) => {
					const Icon = section.icon;

					return (
						<Link key={section.href} href={section.href}>
							<Card className="h-full transition-shadow hover:shadow-md">
								<CardHeader className="flex-row items-center gap-4 space-y-0">
									<div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-muted text-accent">
										<Icon className="h-5 w-5" />
									</div>
									<CardTitle className="text-base">{section.title}</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="text-sm text-ink-muted">{section.description}</p>
								</CardContent>
							</Card>
						</Link>
					);
				})}
			</div>
		</div>
	);
}
