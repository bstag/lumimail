"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_RESPONDER, findResponderForMailbox } from "./vacation-responder-utils";

type VacationResponder = {
	mailboxId: string;
	enabled: boolean;
	subject: string;
	body: string;
	startDate: string | null;
	endDate: string | null;
	replyToContacts: boolean;
	replyToOrganization: boolean;
};

type Mailbox = {
	id: string;
	localPart: string;
	hostname: string;
	role?: string;
};

export function VacationResponderForm() {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
	const [responders, setResponders] = useState<VacationResponder[]>([]);
	const [mailboxId, setMailboxId] = useState("");
	const [enabled, setEnabled] = useState(false);
	const [subject, setSubject] = useState(DEFAULT_RESPONDER.subject);
	const [body, setBody] = useState(DEFAULT_RESPONDER.body);
	const [startDate, setStartDate] = useState("");
	const [endDate, setEndDate] = useState("");
	const [replyToContacts, setReplyToContacts] = useState(false);
	const [replyToOrganization, setReplyToOrganization] = useState(false);
	const [saved, setSaved] = useState(false);

	/** Loads the form from whichever responder belongs to the chosen mailbox. */
	const applyResponder = useCallback((rows: VacationResponder[], id: string) => {
		const r = findResponderForMailbox(rows, id);
		setEnabled(r?.enabled ?? false);
		setSubject(r?.subject ?? DEFAULT_RESPONDER.subject);
		setBody(r?.body ?? DEFAULT_RESPONDER.body);
		setStartDate(r?.startDate ? r.startDate.slice(0, 10) : "");
		setEndDate(r?.endDate ? r.endDate.slice(0, 10) : "");
		setReplyToContacts(r?.replyToContacts ?? false);
		setReplyToOrganization(r?.replyToOrganization ?? false);
	}, []);

	useEffect(() => {
		Promise.all([
			authFetch("/api/mailboxes").then((res) => res.json() as Promise<{ mailboxes: Mailbox[] }>),
			authFetch("/api/vacation").then(
				(res) => res.json() as Promise<{ success: boolean; data?: { responders: VacationResponder[] } }>,
			),
		])
			.then(([mailboxJson, vacationJson]) => {
				// Only a manager may change how a mailbox answers everyone who writes to it.
				const manageable = (mailboxJson.mailboxes ?? []).filter((m) => m.role === "manager");
				const rows = vacationJson.data?.responders ?? [];
				setMailboxes(manageable);
				setResponders(rows);
				const first = manageable[0]?.id ?? "";
				setMailboxId(first);
				applyResponder(rows, first);
			})
			.finally(() => setLoading(false));
	}, [applyResponder]);

	function selectMailbox(id: string) {
		setMailboxId(id);
		applyResponder(responders, id);
		setSaved(false);
	}

	async function save() {
		setSaving(true);
		const payload = {
			mailboxId,
			enabled,
			subject,
			body,
			startDate: startDate ? new Date(startDate).toISOString() : null,
			endDate: endDate ? new Date(endDate).toISOString() : null,
			replyToContacts,
			replyToOrganization,
		};
		await authFetch("/api/vacation", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		// Keep the local copy current so switching mailboxes and back shows the
		// saved values without a refetch.
		setResponders((rows) => [
			...rows.filter((row) => row.mailboxId !== mailboxId),
			payload as VacationResponder,
		]);
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
				{mailboxes.length === 0 ? (
					<p className="text-sm text-ink-muted">
						You do not manage any mailbox, so there is no responder to configure.
					</p>
				) : (
					<>
						<div className="space-y-2">
							<Label htmlFor="vacation-mailbox">Mailbox</Label>
							<select
								id="vacation-mailbox"
								className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
								value={mailboxId}
								onChange={(e) => selectMailbox(e.target.value)}
							>
								{mailboxes.map((mailbox) => (
									<option key={mailbox.id} value={mailbox.id}>
										{mailbox.localPart}@{mailbox.hostname}
									</option>
								))}
							</select>
							<p className="text-sm text-ink-muted">
								Each mailbox has its own responder. Turning one on does not affect the others.
							</p>
						</div>

						<label className="flex items-center gap-2 text-sm cursor-pointer">
							<input
								type="checkbox"
								checked={enabled}
								onChange={(e) => setEnabled(e.target.checked)}
								className="rounded"
							/>
							Enable vacation responder for this mailbox
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
								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<div className="space-y-2">
										<Label>Start date (optional)</Label>
										<Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
									</div>
									<div className="space-y-2">
										<Label>End date (optional)</Label>
										<Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
									</div>
								</div>

								<div className="space-y-2">
									<Label>Who receives a reply</Label>
									<label className="flex items-center gap-2 text-sm cursor-pointer">
										<input
											type="checkbox"
											checked={replyToContacts}
											onChange={(e) => setReplyToContacts(e.target.checked)}
											className="rounded"
										/>
										People in this mailbox&apos;s contacts
									</label>
									<label className="flex items-center gap-2 text-sm cursor-pointer">
										<input
											type="checkbox"
											checked={replyToOrganization}
											onChange={(e) => setReplyToOrganization(e.target.checked)}
											className="rounded"
										/>
										Anyone on a domain in my organization
									</label>
									<p className="text-sm text-ink-muted">
										{replyToContacts || replyToOrganization
											? "Only senders matching a ticked option receive a reply."
											: "Everyone receives a reply. Tick an option to narrow it."}
									</p>
								</div>
							</>
						)}

						<Button onClick={save} disabled={saving}>
							{saved ? "Saved!" : saving ? "Saving…" : "Save"}
						</Button>
					</>
				)}
			</CardContent>
		</Card>
	);
}
