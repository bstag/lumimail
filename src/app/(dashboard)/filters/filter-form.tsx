"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { apiJson } from "@/lib/api/client-response";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FilterLabel } from "./utils";

type TextField = "name" | "fromContains" | "toContains" | "subjectContains" | "hasWords" | "actionExpireDays";
type FlagField = "actionStar" | "actionMarkRead" | "actionArchive" | "actionMoveToTrash";

type FormState = Record<TextField, string> & Record<FlagField, boolean> & {
	matchMode: "all" | "any";
	actionLabelId: string;
	actionFocus: "" | "focused" | "other";
};

function initialState(from: string | null): FormState {
	return {
		name: from ? from : "", fromContains: from ?? "", toContains: "", subjectContains: "", hasWords: "",
		actionExpireDays: "", matchMode: "all", actionStar: false, actionMarkRead: false, actionArchive: false,
		actionMoveToTrash: false, actionLabelId: "", actionFocus: "",
	};
}

const hasCondition = (form: FormState) =>
	[form.fromContains, form.toContains, form.subjectContains, form.hasWords].some((value) => value.trim());

/** The request body for a form; blank fields are omitted. */
export function filterRequestBody(form: FormState, defaultName: string) {
	const optional = (value: string) => value.trim() || undefined;
	return {
		name: form.name.trim() || defaultName,
		fromContains: optional(form.fromContains),
		toContains: optional(form.toContains),
		subjectContains: optional(form.subjectContains),
		hasWords: optional(form.hasWords),
		matchMode: form.matchMode,
		actionStar: form.actionStar,
		actionMarkRead: form.actionMarkRead,
		actionArchive: form.actionArchive,
		actionMoveToTrash: form.actionMoveToTrash,
		actionLabelId: optional(form.actionLabelId),
		actionFocus: form.actionFocus || undefined,
		actionExpireDays: form.actionExpireDays ? Number(form.actionExpireDays) : undefined,
	};
}

/** Creates a filter; a `?from=` address (Filter messages like this) prefills the sender (F101). */
export function FilterForm({ labels, onCreated }: { labels: FilterLabel[]; onCreated: (id: string) => void }) {
	const t = useTranslations("filters");
	const qc = useQueryClient();
	const from = useSearchParams().get("from");
	const [form, setForm] = useState<FormState>(() => initialState(from));
	const [missingCondition, setMissingCondition] = useState(false);
	const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

	const create = useMutation({
		mutationFn: () => apiJson.post<{ id: string }>("/api/filters", filterRequestBody(form, t("defaultName"))),
		onSuccess: ({ id }) => {
			void qc.invalidateQueries({ queryKey: ["filters"] });
			setForm(initialState(null));
			onCreated(id);
		},
	});

	function submit() {
		setMissingCondition(!hasCondition(form));
		if (hasCondition(form)) create.mutate();
	}

	const text = (key: TextField, label: string, placeholder: string) => (
		<div className="space-y-2">
			<Label htmlFor={`filter-${key}`}>{label}</Label>
			<Input id={`filter-${key}`} placeholder={placeholder} value={form[key]} onChange={(e) => set(key, e.target.value)} />
		</div>
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("createTitle")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{text("name", t("nameLabel"), t("namePlaceholder"))}
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="text-sm font-medium text-ink-muted">{t("conditionsHeading")}</div>
					<Select id="filter-matchMode" size="sm" className="w-auto" aria-label={t("matchModeLabel")} value={form.matchMode}
						onChange={(e) => set("matchMode", e.target.value as FormState["matchMode"])}>
						<option value="all">{t("matchAll")}</option>
						<option value="any">{t("matchAny")}</option>
					</Select>
				</div>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{text("fromContains", t("fromContains"), t("fromPlaceholder"))}
					{text("toContains", t("toContains"), t("toPlaceholder"))}
					{text("subjectContains", t("subjectContains"), t("subjectPlaceholder"))}
					{text("hasWords", t("hasWords"), t("hasWordsPlaceholder"))}
				</div>
				<p className="text-xs text-ink-faint">{t("alternativesHint")}</p>
				<div className="text-sm font-medium text-ink-muted">{t("actionsHeading")}</div>
				<div className="space-y-2">
					{([
						["actionStar", t("actionStar")], ["actionMarkRead", t("actionMarkRead")],
						["actionArchive", t("actionArchive")], ["actionMoveToTrash", t("actionMoveToTrash")],
					] as const).map(([key, label]) => (
						<label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
							<input type="checkbox" className="rounded" checked={form[key]} onChange={(e) => set(key, e.target.checked)} />
							{label}
						</label>
					))}
				</div>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
					<div className="space-y-2">
						<Label htmlFor="filter-label">{t("applyLabel")}</Label>
						<Select id="filter-label" value={form.actionLabelId} onChange={(e) => set("actionLabelId", e.target.value)}>
							<option value="">{t("noneOption")}</option>
							{labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
						</Select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="filter-focus">{t("showIn")}</Label>
						<Select id="filter-focus" value={form.actionFocus} onChange={(e) => set("actionFocus", e.target.value as FormState["actionFocus"])}>
							<option value="">{t("noneOption")}</option>
							<option value="focused">{t("showInFocused")}</option>
							<option value="other">{t("showInOther")}</option>
						</Select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="filter-actionExpireDays">{t("expireLabel")}</Label>
						<Input id="filter-actionExpireDays" type="number" min={1} max={365} placeholder={t("expirePlaceholder")}
							value={form.actionExpireDays} onChange={(e) => set("actionExpireDays", e.target.value)} />
					</div>
				</div>
				{missingCondition && <p role="alert" className="text-sm text-danger">{t("conditionRequired")}</p>}
				{create.isError && <p role="alert" className="text-sm text-danger">{t("createFailed")}</p>}
				<Button onClick={submit} disabled={create.isPending}>
					<Plus className="mr-2 h-4 w-4" />
					{t("createTitle")}
				</Button>
			</CardContent>
		</Card>
	);
}
