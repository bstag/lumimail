"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ComposeForm } from "@/components/compose/compose-form";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { findSendCapableMailbox } from "@/components/mailbox-provider-utils";

export default function ComposePage() {
	const t = useTranslations("compose");
	const router = useRouter();
	const { mailboxes, isLoading } = useSelectedMailbox();
	const canSend = Boolean(findSendCapableMailbox(mailboxes));

	useEffect(() => {
		if (!isLoading && !canSend) router.replace("/inbox");
	}, [canSend, isLoading, router]);

	if (isLoading || !canSend) return null;
	return (
		<div className="h-full overflow-auto p-8">
			<div className="mb-6">
				<h1 className="text-2xl font-normal text-ink">{t("pageTitle")}</h1>
				<p className="mt-1 text-sm text-ink-muted">{t("pageDesc")}</p>
			</div>
			<ComposeForm mode="page" />
		</div>
	);
}
