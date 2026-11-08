"use client";

import { Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiJson } from "@/lib/api/client-response";
import { labelKeys } from "@/lib/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchFilterLabels, fetchMessageFilters } from "./utils";
import { FilterForm } from "./filter-form";
import { FilterRow } from "./filter-row";

export default function FiltersPage() {
	const t = useTranslations("filters");
	const qc = useQueryClient();
	const [createdId, setCreatedId] = useState<string | null>(null);
	const filters = useQuery({ queryKey: ["filters"], queryFn: fetchMessageFilters });
	const labels = useQuery({ queryKey: labelKeys.all, queryFn: fetchFilterLabels });

	const remove = useMutation({
		mutationFn: (id: string) => apiJson.delete<{ ok: true }>(`/api/filters/${id}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
	});

	const rows = filters.data ?? [];
	return (
		<div className="max-w-2xl space-y-6 px-4 py-6 sm:px-12 sm:py-8">
			<h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
			<p className="text-sm text-ink-muted">{t("desc")}</p>
			{/* The form reads ?from= (Filter messages like this), which needs a Suspense boundary. */}
			<Suspense>
				<FilterForm labels={labels.data ?? []} onCreated={setCreatedId} />
			</Suspense>
			<Card>
				<CardHeader>
					<CardTitle>{t("activeTitle")}</CardTitle>
				</CardHeader>
				<CardContent>
					{rows.length === 0 ? (
						<p className="text-sm text-ink-faint">{t("empty")}</p>
					) : (
						<ul className="divide-y divide-border">
							{rows.map((filter) => (
								<FilterRow key={filter.id} filter={filter} autoPreview={filter.id === createdId}
									onDelete={(id) => remove.mutate(id)} />
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
