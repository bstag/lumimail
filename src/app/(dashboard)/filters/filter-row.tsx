"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Filter, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { messageKeys } from "@/lib/query-keys";
import { applyFilter, describeFilter, previewFilter, type MessageFilter } from "./utils";

type ApplyState =
	| { step: "idle" }
	| { step: "busy" }
	| { step: "preview"; count: number }
	| { step: "done"; count: number }
	| { step: "error" };

/** One filter with its If/Then summary, Apply to existing mail (preview, then apply), and delete. */
export function FilterRow({ filter, autoPreview, onDelete }: {
	filter: MessageFilter;
	autoPreview: boolean;
	onDelete: (id: string) => void;
}) {
	const t = useTranslations("filters");
	const qc = useQueryClient();
	const [state, setState] = useState<ApplyState>({ step: "idle" });
	const { ifLine, thenLine } = describeFilter(filter, t);

	async function run(step: "preview" | "done") {
		setState({ step: "busy" });
		try {
			const count = step === "preview" ? await previewFilter(filter.id) : await applyFilter(filter.id);
			setState({ step, count });
			if (step === "done") void qc.invalidateQueries({ queryKey: messageKeys.all });
		} catch {
			setState({ step: "error" });
		}
	}

	// A filter that was just created offers to clean up the backlog straight away.
	useEffect(() => {
		if (!autoPreview) return;
		let active = true;
		void previewFilter(filter.id).then(
			(count) => { if (active) setState({ step: "preview", count }); },
			() => { if (active) setState({ step: "error" }); },
		);
		return () => { active = false; };
	}, [autoPreview, filter.id]);

	return (
		<li className="space-y-2 py-3">
			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 items-start gap-3 text-sm">
					<Filter className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
					<div className="min-w-0">
						<div className="font-medium">{filter.name}</div>
						<div className="mt-1 text-xs text-ink-muted">{ifLine}</div>
						<div className="text-xs text-ink-muted">{thenLine}</div>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<Button variant="outline" size="sm" disabled={state.step === "busy"} onClick={() => void run("preview")}>
						{t("applyExisting")}
					</Button>
					<Button variant="ghost" size="sm" aria-label={t("deleteFilter")} onClick={() => onDelete(filter.id)}
						className="text-danger hover:text-danger">
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>
			<ApplyStatus state={state} onApply={() => void run("done")} onCancel={() => setState({ step: "idle" })} />
		</li>
	);
}

function ApplyStatus({ state, onApply, onCancel }: { state: ApplyState; onApply: () => void; onCancel: () => void }) {
	const t = useTranslations("filters");
	if (state.step === "error") return <p role="alert" className="ml-7 text-xs text-danger">{t("applyFailed")}</p>;
	if (state.step === "done") return <p role="status" className="ml-7 text-xs text-ink-muted">{t("applyDone", { count: state.count })}</p>;
	if (state.step !== "preview") return null;
	return (
		<div role="status" className="ml-7 flex flex-wrap items-center gap-2 rounded-md bg-surface-subtle px-3 py-2 text-xs text-ink-muted">
			<span>{t("applyPreview", { count: state.count })}</span>
			{state.count > 0 && <Button size="sm" onClick={onApply}>{t("applyConfirm", { count: state.count })}</Button>}
			<Button size="sm" variant="ghost" onClick={onCancel}>{t("cancel")}</Button>
		</div>
	);
}
