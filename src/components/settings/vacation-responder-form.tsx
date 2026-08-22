"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth/client";
import { fetchMailboxOptions } from "@/components/mailbox-provider-utils";
import { mailboxKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_RESPONDER, findResponderForMailbox } from "./vacation-responder-utils";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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

/** Key for the vacation responder list; used only by this form. */
const vacationKeys = {
	all: ["vacation"] as const,
};

async function fetchVacationResponders(): Promise<VacationResponder[]> {
	const res = await authFetch("/api/vacation");
	const json = (await res.json()) as {
		success: boolean;
		data?: { responders: VacationResponder[] };
	};
	return json.data?.responders ?? [];
}

function responderValue<T>(value: T | null | undefined, fallback: T) {
	return value ?? fallback;
}

function responderDate(value: string | null | undefined) {
	return value ? value.slice(0, 10) : "";
}

function VacationResponderFields({ mailboxes, mailboxId, enabled, subject, body, startDate, endDate, replyToContacts, replyToOrganization, saving, saved, onMailbox, setEnabled, setSubject, setBody, setStartDate, setEndDate, setReplyToContacts, setReplyToOrganization, onSave }: {
	mailboxes: Mailbox[]; mailboxId: string; enabled: boolean; subject: string; body: string; startDate: string; endDate: string; replyToContacts: boolean; replyToOrganization: boolean; saving: boolean; saved: boolean;
	onMailbox: (id: string) => void; setEnabled: (value: boolean) => void; setSubject: (value: string) => void; setBody: (value: string) => void; setStartDate: (value: string) => void; setEndDate: (value: string) => void; setReplyToContacts: (value: boolean) => void; setReplyToOrganization: (value: boolean) => void; onSave: () => void;
}) {
	if (mailboxes.length === 0) return <p className="text-sm text-ink-muted">You do not manage any mailbox, so there is no responder to configure.</p>;
	return <><div className="space-y-2"><Label htmlFor="vacation-mailbox">Mailbox</Label><Select id="vacation-mailbox" value={mailboxId} onChange={(event) => onMailbox(event.target.value)}>{mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.localPart}@{mailbox.hostname}</option>)}</Select><p className="text-sm text-ink-muted">Each mailbox has its own responder. Turning one on does not affect the others.</p></div><label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="rounded" />Enable vacation responder for this mailbox</label>{enabled && <><div className="space-y-2"><Label>Subject</Label><Input value={subject} onChange={(event) => setSubject(event.target.value)} /></div><div className="space-y-2"><Label>Message</Label><Textarea className="min-h-[100px] resize-y" value={body} onChange={(event) => setBody(event.target.value)} /></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Start date (optional)</Label><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div><div className="space-y-2"><Label>End date (optional)</Label><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div></div><div className="space-y-2"><Label>Who receives a reply</Label><label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={replyToContacts} onChange={(event) => setReplyToContacts(event.target.checked)} className="rounded" />People in this mailbox&apos;s contacts</label><label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={replyToOrganization} onChange={(event) => setReplyToOrganization(event.target.checked)} className="rounded" />Anyone on a domain in my organization</label><p className="text-sm text-ink-muted">{replyToContacts || replyToOrganization ? "Only senders matching a ticked option receive a reply." : "Everyone receives a reply. Tick an option to narrow it."}</p></div></>}<Button onClick={onSave} disabled={saving}>{saved ? "Saved!" : saving ? "Saving…" : "Save"}</Button></>;
}

export function VacationResponderForm({ initialMailboxes }: { initialMailboxes?: Mailbox[] } = {}) {
	const queryClient = useQueryClient();
	const [loading, setLoading] = useState(initialMailboxes === undefined);
	const [saving, setSaving] = useState(false);
	const [mailboxes, setMailboxes] = useState<Mailbox[]>(initialMailboxes ?? []);
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
		setEnabled(responderValue(r?.enabled, false));
		setSubject(responderValue(r?.subject, DEFAULT_RESPONDER.subject));
		setBody(responderValue(r?.body, DEFAULT_RESPONDER.body));
		setStartDate(responderDate(r?.startDate));
		setEndDate(responderDate(r?.endDate));
		setReplyToContacts(responderValue(r?.replyToContacts, false));
		setReplyToOrganization(responderValue(r?.replyToOrganization, false));
	}, []);

	const mailboxesQuery = useQuery({
		queryKey: mailboxKeys.options,
		queryFn: fetchMailboxOptions,
		retry: false,
	});
	const respondersQuery = useQuery({
		queryKey: vacationKeys.all,
		queryFn: fetchVacationResponders,
		retry: false,
	});

	// The form is an editing buffer: seed it once from the two queries, then
	// let local state own the values (a later background refetch must not
	// clobber in-progress edits).
	const initialized = useRef(false);
	useEffect(() => {
		if (initialized.current) return;
		if (mailboxesQuery.isPending || respondersQuery.isPending) return;
		initialized.current = true;

		// Only a manager may change how a mailbox answers everyone who writes to it.
		const manageable = (mailboxesQuery.data ?? []).filter((m) => m.role === "manager");
		const rows = respondersQuery.data ?? [];
		setMailboxes(manageable);
		setResponders(rows);
		const first = manageable[0]?.id ?? "";
		setMailboxId(first);
		applyResponder(rows, first);
		setLoading(false);
	}, [applyResponder, mailboxesQuery.data, mailboxesQuery.isPending, respondersQuery.data, respondersQuery.isPending]);

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
		// Refresh the cached responder list so the next mount sees the save.
		void queryClient.invalidateQueries({ queryKey: vacationKeys.all });
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
			<CardContent className="space-y-4"><VacationResponderFields mailboxes={mailboxes} mailboxId={mailboxId} enabled={enabled} subject={subject} body={body} startDate={startDate} endDate={endDate} replyToContacts={replyToContacts} replyToOrganization={replyToOrganization} saving={saving} saved={saved} onMailbox={selectMailbox} setEnabled={setEnabled} setSubject={setSubject} setBody={setBody} setStartDate={setStartDate} setEndDate={setEndDate} setReplyToContacts={setReplyToContacts} setReplyToOrganization={setReplyToOrganization} onSave={save} /></CardContent>
		</Card>
	);
}
