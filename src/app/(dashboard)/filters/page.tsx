"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Filter } from "lucide-react";
import { apiJson } from "@/lib/api/client-response";
import { labelKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { fetchFilterLabels, fetchMessageFilters, type MessageFilter } from "./utils";
import { Select } from "@/components/ui/select";

export default function FiltersPage() {
	const t = useTranslations("filters");
	const qc = useQueryClient();
	const [name, setName] = useState("");
	const [fromContains, setFromContains] = useState("");
	const [subjectContains, setSubjectContains] = useState("");
	const [actionStar, setActionStar] = useState(false);
	const [actionMarkRead, setActionMarkRead] = useState(false);
	const [actionArchive, setActionArchive] = useState(false);
	const [actionLabelId, setActionLabelId] = useState("");
	const [actionMoveToTrash, setActionMoveToTrash] = useState(false);

	const filters = useQuery({
		queryKey: ["filters"],
		queryFn: fetchMessageFilters,
	});

	const labels = useQuery({
		queryKey: labelKeys.all,
		queryFn: fetchFilterLabels,
	});

	const create = useMutation({
		mutationFn: async () => {
			await apiJson.post<{ id: string }>("/api/filters", {
				name: name || t("defaultName"),
				fromContains: fromContains || undefined,
				subjectContains: subjectContains || undefined,
				actionStar,
				actionMarkRead,
				actionArchive,
				actionLabelId: actionLabelId || undefined,
				actionMoveToTrash,
			});
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["filters"] });
			setName("");
			setFromContains("");
			setSubjectContains("");
			setActionStar(false);
			setActionMarkRead(false);
			setActionArchive(false);
			setActionLabelId("");
			setActionMoveToTrash(false);
		},
	});

	const remove = useMutation({
		mutationFn: async (id: string) => {
			await apiJson.delete<{ ok: true }>(`/api/filters/${id}`);
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
	});

	const describeFilter = (f: MessageFilter) => {
		const conds: string[] = [];
		if (f.fromContains) conds.push(t("condFrom", { value: f.fromContains }));
		if (f.subjectContains) conds.push(t("condSubject", { value: f.subjectContains }));
		if (f.toContains) conds.push(t("condTo", { value: f.toContains }));
		if (f.hasWords) conds.push(t("condWords", { value: f.hasWords }));
		const acts: string[] = [];
		if (f.actionStar) acts.push(t("actStar"));
		if (f.actionMarkRead) acts.push(t("actMarkRead"));
		if (f.actionArchive) acts.push(t("actArchive"));
		if (f.actionMoveToTrash) acts.push(t("actTrash"));
		if (f.actionLabelId) acts.push(t("actLabel"));
		return { conds, acts };
	};

	return (
		<div className="max-w-2xl space-y-6 px-4 py-6 sm:px-12 sm:py-8">
			<h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
			<p className="text-sm text-ink-muted">
				{t("desc")}
			</p>

			<Card>
				<CardHeader>
					<CardTitle>{t("createTitle")}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label>{t("nameLabel")}</Label>
						<Input placeholder={t("namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="text-sm font-medium text-ink-muted mt-2">{t("conditionsHeading")}</div>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label>{t("fromContains")}</Label>
							<Input placeholder={t("fromPlaceholder")} value={fromContains} onChange={(e) => setFromContains(e.target.value)} />
						</div>
						<div className="space-y-2">
							<Label>{t("subjectContains")}</Label>
							<Input placeholder={t("subjectPlaceholder")} value={subjectContains} onChange={(e) => setSubjectContains(e.target.value)} />
						</div>
					</div>
					<div className="text-sm font-medium text-ink-muted mt-2">{t("actionsHeading")}</div>
					<div className="space-y-2">
						{[
							{ label: t("actionStar"), checked: actionStar, onChange: setActionStar },
							{ label: t("actionMarkRead"), checked: actionMarkRead, onChange: setActionMarkRead },
							{ label: t("actionArchive"), checked: actionArchive, onChange: setActionArchive },
							{ label: t("actionMoveToTrash"), checked: actionMoveToTrash, onChange: setActionMoveToTrash },
						].map(({ label, checked, onChange }) => (
							<label key={label} className="flex items-center gap-2 text-sm cursor-pointer">
								<input
									type="checkbox"
									checked={checked}
									onChange={(e) => onChange(e.target.checked)}
									className="rounded"
								/>
								{label}
							</label>
						))}
						<div className="space-y-2">
							<Label>{t("applyLabel")}</Label>
							<Select
								value={actionLabelId}
								onChange={(e) => setActionLabelId(e.target.value)}
							>
								<option value="">{t("noneOption")}</option>
								{(labels.data ?? []).map((l) => (
									<option key={l.id} value={l.id}>{l.name}</option>
								))}
							</Select>
						</div>
					</div>
					<Button onClick={() => create.mutate()} disabled={create.isPending}>
						<Plus className="h-4 w-4 mr-2" />
						{t("createTitle")}
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("activeTitle")}</CardTitle>
				</CardHeader>
				<CardContent>
					{(filters.data ?? []).length === 0 ? (
						<p className="text-sm text-ink-faint">{t("empty")}</p>
					) : (
						<ul className="divide-y divide-border">
							{(filters.data ?? []).map((f) => {
								const { conds, acts } = describeFilter(f);
								return (
									<li key={f.id} className="flex items-start justify-between py-3 gap-4">
										<div className="flex items-start gap-3 text-sm min-w-0">
											<Filter className="h-4 w-4 text-ink-faint mt-0.5 shrink-0" />
											<div className="min-w-0">
												<div className="font-medium">{f.name}</div>
												<div className="text-xs text-ink-muted mt-1">
													{conds.length > 0 ? t("ifPrefix", { conditions: conds.join(", ") }) : t("alwaysMatches")}
												</div>
												<div className="text-xs text-ink-muted">
													{t("thenPrefix", { actions: acts.length > 0 ? acts.join(", ") : t("noAction") })}
												</div>
											</div>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => remove.mutate(f.id)}
											className="text-danger hover:text-danger shrink-0"
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</li>
								);
							})}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
