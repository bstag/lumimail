"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type VacationResponder = {
	enabled: boolean;
	subject: string;
	body: string;
	startDate: string | null;
	endDate: string | null;
};

export function VacationResponderForm() {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [enabled, setEnabled] = useState(false);
	const [subject, setSubject] = useState("Out of office");
	const [body, setBody] = useState("I am currently out of office and will reply when I return.");
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		authFetch("/api/vacation")
			.then((res) => res.json() as Promise<{ success: boolean; data?: { responder: VacationResponder | null } }>)
			.then((json) => {
				const r = json.data?.responder;
				if (r) {
					setEnabled(r.enabled);
					setSubject(r.subject);
					setBody(r.body);
					setStartDate(r.startDate ? r.startDate.slice(0, 10) : "");
					setEndDate(r.endDate ? r.endDate.slice(0, 10) : "");
				}
			})
			.finally(() => setLoading(false));
	}, []);

	async function save() {
		setSaving(true);
		await authFetch("/api/vacation", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				enabled,
				subject,
				body,
				startDate: startDate ? new Date(startDate).toISOString() : null,
				endDate: endDate ? new Date(endDate).toISOString() : null,
			}),
		});
		setSaving(false);
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	}

	if (loading) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Vacation responder</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<label className="flex items-center gap-2 text-sm cursor-pointer">
					<input
						type="checkbox"
						checked={enabled}
						onChange={(e) => setEnabled(e.target.checked)}
						className="rounded"
					/>
					Enable vacation responder
				</label>

				{enabled && (
					<>
						<div className="space-y-2">
							<Label>Subject</Label>
							<Input value={subject} onChange={(e) => setSubject(e.target.value)} />
						</div>
						<div className="space-y-2">
							<Label>Message</Label>
							<textarea
								className="w-full min-h-[100px] rounded-md border border-border px-3 py-2 text-sm resize-y"
								value={body}
								onChange={(e) => setBody(e.target.value)}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label>Start date (optional)</Label>
								<Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
							</div>
							<div className="space-y-2">
								<Label>End date (optional)</Label>
								<Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
							</div>
						</div>
					</>
				)}

				<Button onClick={save} disabled={saving}>
					{saved ? "Saved!" : saving ? "Saving…" : "Save"}
				</Button>
			</CardContent>
		</Card>
	);
}
