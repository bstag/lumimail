"use client";

import Link from "next/link";
import { Globe2, KeyRound, Mail, Settings, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminSettingsPage() {
	const t = useTranslations("admin");

	const sections = [
		{ href: "/mailboxes", title: t("mailboxesCard"), description: t("mailboxesDesc"), icon: Mail },
		{ href: "/domains", title: t("domainsCard"), description: t("domainsDesc"), icon: Globe2 },
		{ href: "/api-keys", title: t("apiKeysCard"), description: t("apiKeysDesc"), icon: KeyRound },
		{ href: "/webhooks", title: t("webhooksCard"), description: t("webhooksDesc"), icon: Webhook },
		{ href: "/settings", title: t("accountCard"), description: t("accountDesc"), icon: Settings },
	];

	return (
		<div className="h-full overflow-auto">
			<div className="mb-8">
				<h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
				<p className="mt-2 text-sm text-ink-muted">{t("desc")}</p>
			</div>
			<div className="grid max-w-5xl gap-4 md:grid-cols-2">
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
