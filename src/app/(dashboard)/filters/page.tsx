"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Filter } from "lucide-react";
import { authFetch } from "@/lib/auth/client";
import { parseApiResponse } from "@/lib/api/client-response";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { fetchFilterLabels, fetchMessageFilters, type MessageFilter } from "./utils";

export default function FiltersPage() {
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
		queryKey: ["labels"],
		queryFn: fetchFilterLabels,
	});

	const create = useMutation({
		mutationFn: async () => {
			const res = await authFetch("/api/filters", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: name || "My filter",
					fromContains: fromContains || undefined,
					subjectContains: subjectContains || undefined,
					actionStar,
					actionMarkRead,
					actionArchive,
					actionLabelId: actionLabelId || undefined,
					actionMoveToTrash,
				}),
			});
			await parseApiResponse<{ id: string }>(res);
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
			const res = await authFetch(`/api/filters/${id}`, { method: "DELETE" });
			await parseApiResponse<{ ok: true }>(res);
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
	});

	const describeFilter = (f: MessageFilter) => {
		const conds: string[] = [];
		if (f.fromContains) conds.push(`from contains "${f.fromContains}"`);
		if (f.subjectContains) conds.push(`subject contains "${f.subjectContains}"`);
		if (f.toContains) conds.push(`to contains "${f.toContains}"`);
		if (f.hasWords) conds.push(`has words "${f.hasWords}"`);
		const acts: string[] = [];
		if (f.actionStar) acts.push("star it");
		if (f.actionMarkRead) acts.push("mark as read");
		if (f.actionArchive) acts.push("archive it");
		if (f.actionMoveToTrash) acts.push("move to trash");
		if (f.actionLabelId) acts.push("apply label");
		return { conds, acts };
	};

	return (
		<div className="space-y-6 max-w-2xl">
			<h1 className="text-2xl font-semibold text-ink">Filters</h1>
			<p className="text-sm text-ink-muted">
				Filters automatically apply actions to incoming messages that match your conditions.
			</p>

			<Card>
				<CardHeader>
					<CardTitle>Create filter</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label>Filter name</Label>
						<Input placeholder="e.g. Newsletter auto-archive" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="text-sm font-medium text-ink-muted mt-2">Conditions (messages matching any)</div>
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label>From contains</Label>
							<Input placeholder="newsletter@" value={fromContains} onChange={(e) => setFromContains(e.target.value)} />
						</div>
						<div className="space-y-2">
							<Label>Subject contains</Label>
							<Input placeholder="unsubscribe" value={subjectContains} onChange={(e) => setSubjectContains(e.target.value)} />
						</div>
					</div>
					<div className="text-sm font-medium text-ink-muted mt-2">Actions</div>
					<div className="space-y-2">
						{[
							{ label: "Star it", checked: actionStar, onChange: setActionStar },
							{ label: "Mark as read", checked: actionMarkRead, onChange: setActionMarkRead },
							{ label: "Archive (skip inbox)", checked: actionArchive, onChange: setActionArchive },
							{ label: "Move to trash", checked: actionMoveToTrash, onChange: setActionMoveToTrash },
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
							<Label>Apply label</Label>
							<select
								className="w-full h-10 rounded-md border border-border px-3 text-sm"
								value={actionLabelId}
								onChange={(e) => setActionLabelId(e.target.value)}
							>
								<option value="">— none —</option>
								{(labels.data ?? []).map((l) => (
									<option key={l.id} value={l.id}>{l.name}</option>
								))}
							</select>
						</div>
					</div>
					<Button onClick={() => create.mutate()} disabled={create.isPending}>
						<Plus className="h-4 w-4 mr-2" />
						Create filter
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Active filters</CardTitle>
				</CardHeader>
				<CardContent>
					{(filters.data ?? []).length === 0 ? (
						<p className="text-sm text-ink-faint">No filters yet.</p>
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
													{conds.length > 0 ? `If: ${conds.join(", ")}` : "Always matches"}
												</div>
												<div className="text-xs text-ink-muted">
													Then: {acts.length > 0 ? acts.join(", ") : "no action"}
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
