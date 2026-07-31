"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ListSection } from "@/components/ui/list-section";
import { apiJson } from "@/lib/api/client-response";

export default function WebhooksPage() {
	const t = useTranslations("admin");
	const tCommon = useTranslations("common");
	const qc = useQueryClient();
	const [url, setUrl] = useState("");
	const [secret, setSecret] = useState<string | null>(null);

	const { data, isLoading } = useQuery({
		queryKey: ["webhooks"],
		queryFn: () => apiJson.get<{ webhooks: { id: string; url: string }[] }>("/api/webhooks"),
	});

	const create = useMutation({
		mutationFn: async () => {
			const json = await apiJson.post<{ secret?: string }>("/api/webhooks", {
				url,
				events: ["message.inbound", "message.outbound", "message.failed"],
			});
			setSecret(json.secret ?? null);
			setUrl("");
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
	});

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-semibold text-ink">{t("webhooksTitle")}</h1>
			{secret && (
				<Card>
					<CardContent className="pt-6 text-sm">
						<p>{t("signingSecret")}</p>
						<code className="block mt-1 text-xs break-all">{secret}</code>
					</CardContent>
				</Card>
			)}
			<Card>
				<CardHeader>
					<CardTitle>{t("addWebhookTitle")}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<FormField label={t("webhookUrl")} htmlFor="webhook-url">
						<Input id="webhook-url" value={url} onChange={(e) => setUrl(e.target.value)} />
					</FormField>
					<Button onClick={() => create.mutate()} disabled={!url || create.isPending}>
						{tCommon("add")}
					</Button>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>{t("endpoints")}</CardTitle>
				</CardHeader>
				<CardContent>
					<ListSection
						loading={isLoading}
						loadingLabel={t("loadingWebhooks")}
						empty={(data?.webhooks ?? []).length === 0}
						emptyLabel={t("noWebhooks")}
						emptyIcon={Webhook}
					>
						<div className="text-sm font-mono space-y-1">
							{(data?.webhooks ?? []).map((w) => (
								<p key={w.id} className="truncate">
									{w.url}
								</p>
							))}
						</div>
					</ListSection>
				</CardContent>
			</Card>
		</div>
	);
}
