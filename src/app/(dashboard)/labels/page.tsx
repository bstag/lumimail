"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Tag, X } from "lucide-react";
import { apiJson } from "@/lib/api/client-response";
import { labelKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { ListSection } from "@/components/ui/list-section";

type Label = {
	id: string;
	name: string;
	color: string;
	createdAt: string;
};

const PRESET_COLORS = [
	"#6366f1",
	"#ec4899",
	"#f59e0b",
	"#10b981",
	"#3b82f6",
	"#ef4444",
	"#8b5cf6",
	"#14b8a6",
];

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

async function fetchLabels(): Promise<Label[]> {
	// Tolerates the legacy `{ labels: [] }` shape some clients still mock.
	const data = await apiJson.get<unknown>("/api/labels");
	return Array.isArray(data) ? (data as Label[]) : [];
}

export default function LabelsPage() {
	const t = useTranslations("labels");
	const tCommon = useTranslations("common");
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [color, setColor] = useState(PRESET_COLORS[0]);
	const [formError, setFormError] = useState<string | null>(null);

	const { data: labels = [], isLoading } = useQuery({
		queryKey: labelKeys.all,
		queryFn: fetchLabels,
	});

	const createMutation = useMutation({
		mutationFn: async () => {
			await apiJson.post<Label>("/api/labels", { name: name.trim(), color });
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: labelKeys.all });
			setName("");
			setColor(PRESET_COLORS[0]);
			setFormError(null);
		},
		onError: (err: Error) => {
			setFormError(err.message);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			await apiJson.delete<{ id: string }>(`/api/labels/${id}`);
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: labelKeys.all });
		},
	});

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim()) {
			setFormError(t("nameRequired"));
			return;
		}
		createMutation.mutate();
	}

	return (
		<div className="space-y-8 px-4 py-6 sm:px-12 sm:py-8">
			<div>
				<h2 className="text-xl font-semibold text-ink">{t("title")}</h2>
				<p className="text-sm text-ink-muted">{t("desc")}</p>
			</div>

			<form onSubmit={handleSubmit} className="rounded-lg border border-border bg-surface-raised p-4 space-y-4">
				<h3 className="text-sm font-medium text-ink-muted">{t("newLabel")}</h3>

				{formError && (
					<p className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-danger">{formError}</p>
				)}

				<div className="flex items-center gap-3">
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("namePlaceholder")}
						className="h-9 flex-1 rounded-md border border-border bg-surface-subtle px-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-border-strong"
					/>
					<Button type="submit" disabled={createMutation.isPending} className="gap-2">
						<Plus className="h-4 w-4" />
						{tCommon("create")}
					</Button>
				</div>

				<div className="flex items-center gap-2">
					<span className="text-xs text-ink-muted">{t("colorLabel")}</span>
					{PRESET_COLORS.map((c) => (
						<button
							key={c}
							type="button"
							onClick={() => setColor(c)}
							className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
							style={{
								backgroundColor: c,
								borderColor: color === c ? "var(--ink)" : "transparent",
							}}
						/>
					))}
				</div>
			</form>

			<ListSection
				loading={isLoading}
				loadingLabel={tCommon("loading")}
				empty={labels.length === 0}
				emptyLabel={t("empty")}
				emptyIcon={Tag}
			>
				<div className="space-y-2">
					{labels.map((label) => (
						<div
							key={label.id}
							className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-4 py-3"
						>
							<div className="flex items-center gap-3">
								<span
									className="h-3 w-3 rounded-full flex-shrink-0"
									style={{ backgroundColor: label.color }}
								/>
								<span className="text-sm font-medium text-ink">{label.name}</span>
							</div>
							<button
								type="button"
								onClick={() => deleteMutation.mutate(label.id)}
								disabled={deleteMutation.isPending}
								className="text-ink-faint hover:text-danger"
								title={t("deleteLabel")}
							>
								<X className="h-4 w-4" />
							</button>
						</div>
					))}
				</div>
			</ListSection>
		</div>
	);
}
