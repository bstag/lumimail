"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { apiJson } from "@/lib/api/client-response";
import { invalidateMessageQueries, labelKeys } from "@/lib/query-keys";
import { newId } from "@/lib/ids";
import { categorizationConfigSchema } from "@/lib/validators";
import {
	configuredTags,
	type CategorizationConfig,
} from "@/lib/categorization/engine";
import type {
	readConfiguration,
	readInsights,
	previewConfiguration,
	listJobs,
} from "@/lib/categorization/service";
import { QuestionEditor, RuleEditor } from "./question-editor";

type Settings = Awaited<ReturnType<typeof readConfiguration>>;
type Insights = Awaited<ReturnType<typeof readInsights>>;
type Comparison = Awaited<ReturnType<typeof previewConfiguration>>;
type Jobs = Awaited<ReturnType<typeof listJobs>>;
type Tab = "overview" | "questions" | "processing";
const panel = "rounded-lg border border-border bg-background p-4 sm:p-6";

export default function MailInsightsPage() {
	const { scopedMailboxId, isLoading } = useSelectedMailbox();
	const [days, setDays] = useState("30");
	const [sender, setSender] = useState<string | null>(null);
	const [offset, setOffset] = useState(0);
	const [tab, setTab] = useState<Tab>("overview");
	const [draftSender, setDraftSender] = useState<string | null>(null);
	const settings = useQuery({
		queryKey: ["categorization"],
		queryFn: () => apiJson.get<Settings>("/api/categorization"),
		retry: false,
	});
	const params = new URLSearchParams({ days, offset: String(offset) });
	if (scopedMailboxId) params.set("mailboxId", scopedMailboxId);
	if (sender) params.set("sender", sender);
	const insights = useQuery({
		queryKey: ["mail-insights", scopedMailboxId, days, sender, offset],
		queryFn: () => apiJson.get<Insights>(`/api/insights?${params}`),
		enabled: !isLoading,
		retry: false,
	});
	function suggest(source: string) {
		setDraftSender(source);
		setTab("questions");
	}
	return (
		<div className="space-y-6 px-4 py-6 sm:px-10 sm:py-8">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold text-ink">Mail insights</h1>
					<p className="mt-1 text-sm text-ink-muted">
						Understand what arrives, organize it, and tune your classification
						questions.
					</p>
				</div>
				<label className="space-y-1 text-sm">
					Period
					<Select
						value={days}
						onChange={(e) => {
							setDays(e.target.value);
							setOffset(0);
						}}
					>
						<option value="7">Last 7 days</option>
						<option value="30">Last 30 days</option>
						<option value="90">Last 90 days</option>
					</Select>
				</label>
			</div>
			<div
				className="flex flex-wrap gap-2"
				role="tablist"
				aria-label="Mail insights views"
			>
				{(["overview", "questions", "processing"] as const).map((value) => (
					<Button
						key={value}
						id={`insights-${value}-tab`}
						role="tab"
						aria-selected={tab === value}
						aria-controls={`insights-${value}`}
						variant={tab === value ? "default" : "outline"}
						onClick={() => setTab(value)}
					>
						{value === "overview"
							? "Overview"
							: value === "questions"
								? "Questions & rules"
								: "Processing"}
					</Button>
				))}
			</div>
			{settings.isError && (
				<p role="alert" className="text-danger">
					{settings.error.message}{" "}
					<Button
						variant="outline"
						size="sm"
						onClick={() => void settings.refetch()}
					>
						Retry settings
					</Button>
				</p>
			)}
			{tab === "overview" && (
				<section
					role="tabpanel"
					id="insights-overview"
					aria-labelledby="insights-overview-tab"
				>
					{insights.isPending ? (
						<p role="status">Loading mail insights…</p>
					) : insights.isError ? (
						<p role="alert">
							{insights.error.message}{" "}
							<Button variant="outline" onClick={() => void insights.refetch()}>
								Retry
							</Button>
						</p>
					) : (
						<Overview
							data={insights.data}
							sender={sender}
							setSender={(s) => {
								setSender(s);
								setOffset(0);
							}}
							suggest={suggest}
							mailboxId={scopedMailboxId}
							previous={() => setOffset(Math.max(0, offset - 25))}
							next={() => setOffset(offset + 25)}
						/>
					)}
				</section>
			)}
			{tab === "questions" && (
				<section
					role="tabpanel"
					id="insights-questions"
					aria-labelledby="insights-questions-tab"
				>
					{settings.data ? (
						<ConfigurationEditor
							key={`${settings.data.activeVersion}-${draftSender}`}
							settings={settings.data}
							mailboxId={scopedMailboxId}
							draftSender={draftSender}
							onSaved={() => setDraftSender(null)}
						/>
					) : (
						<p role="status">Loading classification settings…</p>
					)}
				</section>
			)}
			{tab === "processing" && (
				<section
					role="tabpanel"
					id="insights-processing"
					aria-labelledby="insights-processing-tab"
				>
					<Processing
						mailboxId={scopedMailboxId}
						active={Boolean(settings.data?.activeVersion)}
					/>
				</section>
			)}
		</div>
	);
}

type UnsubscribeOutcome =
	| { method: "one_click"; ok: boolean }
	| { method: "link" | "mailto"; url: string }
	| { method: "none" };

/** Unsubscribe and archive-all actions for one sender (F98). */
export function SenderCleanup({ sender, mailboxId }: { sender: string; mailboxId: string | null }) {
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<string | null>(null);
	const unsubscribe = useMutation({
		mutationFn: () => apiJson.post<UnsubscribeOutcome>("/api/insights/senders/unsubscribe", { sender, mailboxId }),
		onSuccess: (outcome) => {
			if (outcome.method === "one_click") {
				setStatus(outcome.ok ? "Unsubscribed" : "The sender did not confirm; try again later");
			} else if (outcome.method === "none") {
				setStatus("This sender offers no unsubscribe option");
			} else {
				globalThis.open(outcome.url, "_blank", "noopener,noreferrer");
				setStatus(outcome.method === "link" ? "Opened the sender's unsubscribe page" : "Opened an unsubscribe email");
			}
		},
		onError: () => setStatus("Unsubscribe failed"),
	});
	const archive = useMutation({
		mutationFn: () => apiJson.post<{ archived: number; filterId: string | null }>(
			"/api/insights/senders/archive", { sender, mailboxId, createFilter: true },
		),
		onSuccess: async (result) => {
			setStatus(`Archived ${result.archived.toLocaleString()}; future mail will be archived`);
			await invalidateMessageQueries(queryClient);
		},
		onError: () => setStatus("Archive failed"),
	});
	return <>
		<Button variant="outline" size="sm" disabled={unsubscribe.isPending} onClick={() => unsubscribe.mutate()}>
			Unsubscribe
		</Button>
		<Button variant="outline" size="sm" disabled={archive.isPending} onClick={() => archive.mutate()}>
			Archive all
		</Button>
		{status && <span role="status" className="basis-full text-xs text-ink-muted">{status}</span>}
	</>;
}

function Overview({
	data,
	sender,
	setSender,
	suggest,
	previous,
	next,
	mailboxId,
}: {
	mailboxId: string | null;
	data: Insights;
	sender: string | null;
	setSender: (s: string | null) => void;
	suggest: (s: string) => void;
	previous: () => void;
	next: () => void;
}) {
	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p>
					<span className="text-2xl font-medium tabular-nums">
						{data.total.toLocaleString()}
					</span>{" "}
					received messages in this period
				</p>
				{sender && (
					<Button variant="outline" onClick={() => setSender(null)}>
						All senders
					</Button>
				)}
			</div>
			{data.total === 0 && (
				<p className="text-ink-muted">
					No received mail in this period. Try a longer period or another
					mailbox.
				</p>
			)}
			<div className="grid gap-4 lg:grid-cols-2">
				<section className={panel}>
					<h2 className="mb-3 font-medium">
						Sources {sender && `— ${sender}`}
					</h2>
					<p className="mb-3 text-sm text-ink-muted">
						Inspect recent examples before drafting a sender rule. One sender
						can send several kinds of mail.
					</p>
					<ul>
						{data.senders.map((source) => (
							<li
								key={source.sender}
								className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3"
							>
								<button
									className="min-w-0 break-all text-start text-sm underline underline-offset-4"
									onClick={() => setSender(source.sender)}
								>
									{source.sender}
								</button>
								<div className="flex flex-wrap items-center gap-2">
									<span className="tabular-nums">{source.total}</span>
									<SenderCleanup sender={source.sender} mailboxId={mailboxId} />
									<Button
										variant="outline"
										size="sm"
										onClick={() => suggest(source.sender)}
									>
										Draft rule
									</Button>
								</div>
							</li>
						))}
					</ul>
					<div className="mt-3 flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={!data.offset}
							onClick={previous}
						>
							Previous senders
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={!data.hasMore}
							onClick={next}
						>
							More senders
						</Button>
					</div>
				</section>
				<section className={panel}>
					<h2 className="mb-3 font-medium">Tags in this period</h2>
					{data.tags.length === 0 && (
						<p className="text-sm text-ink-muted">
							No tags yet. Activate a configuration and classify existing mail.
						</p>
					)}
					<ul>
						{data.tags.map((tag) => (
							<li
								key={tag.id}
								className="flex justify-between gap-3 border-t border-border py-3"
							>
								<Link
									className="underline underline-offset-4"
									href={`/label/${tag.id}`}
								>
									{tag.name}
								</Link>
								<span className="tabular-nums">{tag.total}</span>
							</li>
						))}
					</ul>
					<p className="mt-3 text-xs text-ink-muted">
						A message can carry several tags; tag counts overlap.
					</p>
				</section>
			</div>
			<section className={panel}>
				<h2 className="mb-3 font-medium">Received over time</h2>
				<div className="flex flex-wrap gap-3">
					{data.weekly.map((w) => (
						<div key={w.week} className="rounded-md bg-surface p-3">
							<div className="text-xs text-ink-muted">Week {w.week}</div>
							<div className="font-medium tabular-nums">{w.total}</div>
						</div>
					))}
				</div>
				<p className="mt-3 text-xs text-ink-muted">
					UTC weeks use the original email Date when retained, otherwise the
					date stored in this app. Older imports may lack their original dates.
				</p>
			</section>
			<section className={panel}>
				<h2 className="mb-3 font-medium">
					Recent messages and classifications
				</h2>
				<p className="mb-3 text-sm text-ink-muted">
					Review the result and its matching reasons. Your corrections survive
					reclassification.
				</p>
				{data.messages.map((mail) => (
					<MessageClassification key={mail.id} mail={mail} />
				))}
			</section>
		</div>
	);
}

function MessageClassification({
	mail,
}: {
	mail: Insights["messages"][number];
}) {
	const qc = useQueryClient();
	const [value, setValue] = useState(mail.tags.join(", "));
	const correction = useMutation({
		mutationFn: (tags: string[] | null) =>
			apiJson.post("/api/categorization/corrections", {
				messageId: mail.id,
				tags,
			}),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["mail-insights"] });
			await qc.invalidateQueries({ queryKey: labelKeys.all });
			await invalidateMessageQueries(qc);
		},
	});
	return (
		<article className="space-y-2 border-t border-border py-4">
			<Link
				className="font-medium underline underline-offset-4"
				href={`/inbox/${encodeURIComponent(mail.id)}`}
			>
				{mail.subject || "(No subject)"}
			</Link>
			<p className="break-all text-xs text-ink-muted">{mail.fromAddr}</p>
			<div className="text-sm">
				{mail.tags.join(" · ") || "Not tagged"}
				{mail.correction !== null && (
					<span className="ms-2 text-ink-muted">Personal correction</span>
				)}
			</div>
			{mail.evaluation && (
				<details className="text-sm">
					<summary>Why these results?</summary>
					<ul className="my-2 space-y-1">
						{mail.evaluation.tags.map((t, i) => (
							<li key={i}>
								{t.tag}: {t.reason}
							</li>
						))}
					</ul>
					<p>
						Uncertain questions:{" "}
						{mail.evaluation.uncertain.join(", ") || "None"}
					</p>
					<p className="text-xs text-ink-muted">
						Configuration {mail.versionId} · Model {mail.evaluation.model}
					</p>
					<pre className="mt-2 max-w-full overflow-auto whitespace-pre-wrap break-all text-xs">
						{JSON.stringify(mail.evaluation.answers, null, 2)}
					</pre>
				</details>
			)}
			{mail.versionId && (
				<div className="flex flex-wrap items-end gap-2">
					<label className="min-w-0 flex-1 space-y-1 text-sm">
						Correct tags (comma separated)
						<Input value={value} onChange={(e) => setValue(e.target.value)} />
					</label>
					<Button
						size="sm"
						variant="outline"
						disabled={correction.isPending}
						onClick={() =>
							correction.mutate(
								value
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean),
							)
						}
					>
						Save correction
					</Button>
					{mail.correction !== null && (
						<Button
							size="sm"
							variant="ghost"
							disabled={correction.isPending}
							onClick={() => correction.mutate(null)}
						>
							Restore automatic tags
						</Button>
					)}
				</div>
			)}
			{correction.isError && (
				<p role="alert" className="text-sm text-danger">
					{correction.error.message}
				</p>
			)}
		</article>
	);
}

function ConfigurationEditor({
	settings,
	mailboxId,
	draftSender,
	onSaved,
}: {
	settings: Settings;
	mailboxId: string | null;
	draftSender: string | null;
	onSaved: () => void;
}) {
	const qc = useQueryClient();
	const [config, setConfig] = useState<CategorizationConfig>(() => ({
		...settings.config,
		rules: draftSender
			? [
					...settings.config.rules,
					{
						id: newId("rule"),
						name: `Mail from ${draftSender}`,
						enabled: true,
						senderMode: "exact",
						sender: draftSender,
						subject: "",
						words: "",
						tag: "",
					},
				]
			: settings.config.rules,
	}));
	const [automatic, setAutomatic] = useState(settings.automatic);
	const [consent, setConsent] = useState(false);
	const [comparison, setComparison] = useState<{
		fingerprint: string;
		sample: Comparison;
	} | null>(null);
	const [selectedVersion, setSelectedVersion] = useState("");
	const validated = categorizationConfigSchema.safeParse(config);
	const validConfig = validated.success ? validated.data : null;
	const fingerprint = JSON.stringify(config);
	const preview = useMutation({
		mutationFn: (draft: CategorizationConfig) =>
			apiJson.post<Comparison>("/api/categorization/preview", {
				config: draft,
				mailboxId,
				consent: true,
			}),
		onSuccess: (sample, draft) =>
			setComparison({ fingerprint: JSON.stringify(draft), sample }),
	});
	const activate = useMutation({
		mutationFn: () =>
			apiJson.post<Settings>("/api/categorization", {
				config,
				expectedVersion: settings.activeVersion,
				automatic,
				consent,
			}),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["categorization"] });
			onSaved();
		},
	});
	function addQuestion() {
		const key = newId("q")
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, "");
		setConfig({
			...config,
			questions: [
				...config.questions,
				{
					key,
					name: "New question",
					type: "noul",
					enabled: true,
					threshold: 0.95,
					instructions: "Describe the yes/no decision to make about this email",
					tag: null,
				},
			],
		});
	}
	const hasAI = config.questions.some((q) => q.enabled);
	const ready = !hasAI || settings.configured;
	return (
		<div className="space-y-6">
			<section className={panel}>
				<h2 className="mb-2 font-medium">Classification settings</h2>
				<p className="text-sm text-ink-muted">
					Questions send sender, recipient, subject, and up to 8,000 characters
					of text to TypeSafe. Attachments and full threads are excluded. Rules
					run locally. Keep messages in their current folders.
				</p>
				{!settings.configured && (
					<p className="mt-2 text-sm">
						Jev is not configured. Your operator needs to configure the
						TYPESAFE_API_KEY Worker secret. You can disable questions and use
						local rules.
					</p>
				)}
				<div className="mt-4 grid gap-4 sm:grid-cols-2">
					<label className="space-y-1 text-sm">
						Model version
						<Input
							value={config.model}
							onChange={(e) => setConfig({ ...config, model: e.target.value })}
						/>
					</label>
					<label className="space-y-1 text-sm">
						Previous configuration
						<Select
							value={selectedVersion}
							onChange={(e) => setSelectedVersion(e.target.value)}
						>
							<option value="">Choose a version to restore</option>
							{settings.versions.map((v, i) => (
								<option key={v.id} value={v.id}>
									{new Date(v.createdAt).toLocaleString()} · {v.id.slice(-6)}
									{i === 0 ? " (recent)" : ""}
								</option>
							))}
						</Select>
					</label>
				</div>
				<Button
					className="mt-3"
					variant="outline"
					disabled={!selectedVersion}
					onClick={() => {
						const version = settings.versions.find(
							(v) => v.id === selectedVersion,
						);
						if (version) {
							setConfig(structuredClone(version.config));
							setComparison(null);
						}
					}}
				>
					Restore as draft
				</Button>
			</section>
			<section className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="font-medium">Questions sent to Jev</h2>
					<Button
						variant="outline"
						disabled={config.questions.length >= 8}
						onClick={addQuestion}
					>
						Add question
					</Button>
				</div>
				{config.questions.map((q, i) => (
					<QuestionEditor
						key={q.key}
						question={q}
						onChange={(question) =>
							setConfig({
								...config,
								questions: config.questions.map((item, index) =>
									index === i ? question : item,
								),
							})
						}
						onRemove={() =>
							setConfig({
								...config,
								questions: config.questions.filter((_, index) => index !== i),
							})
						}
					/>
				))}
			</section>
			<section className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="font-medium">Local tagging rules</h2>
					<Button
						variant="outline"
						disabled={config.rules.length >= 20}
						onClick={() =>
							setConfig({
								...config,
								rules: [
									...config.rules,
									{
										id: newId("rule"),
										name: "New rule",
										enabled: true,
										senderMode: "exact",
										sender: "",
										subject: "",
										words: "",
										tag: "",
									},
								],
							})
						}
					>
						Add rule
					</Button>
				</div>
				{config.rules.map((r, i) => (
					<RuleEditor
						key={r.id}
						rule={r}
						onChange={(rule) =>
							setConfig({
								...config,
								rules: config.rules.map((item, index) =>
									index === i ? rule : item,
								),
							})
						}
						onRemove={() =>
							setConfig({
								...config,
								rules: config.rules.filter((_, index) => index !== i),
							})
						}
					/>
				))}
			</section>
			<section className={`${panel} space-y-4`}>
				<p className="text-sm">
					Configured tags: {configuredTags(config).join(", ") || "None"}
				</p>
				<label className="flex items-start gap-2 text-sm">
					<input
						className="mt-1"
						type="checkbox"
						checked={consent}
						onChange={(e) => setConsent(e.target.checked)}
					/>
					I agree to send selected email content to TypeSafe for enabled AI
					questions.
				</label>
				<label className="flex items-start gap-2 text-sm">
					<input
						className="mt-1"
						type="checkbox"
						checked={automatic}
						onChange={(e) => setAutomatic(e.target.checked)}
					/>
					Automatically classify new arrivals after activation (all accessible
					mailboxes).
				</label>
				<p className="text-xs text-ink-muted">
					Automatic classification covers mail you can read across this workspace.
					Samples and existing-mail jobs use the mailbox picker.
				</p>
				{!validated.success && (
					<p role="alert" className="text-sm text-danger">
						{validated.error.issues[0].message}
					</p>
				)}
				<div className="flex flex-wrap gap-3">
					<Button
						variant="outline"
						disabled={
							!validConfig || !ready || (hasAI && !consent) || preview.isPending
						}
						onClick={() => preview.mutate(structuredClone(config))}
					>
						{preview.isPending ? "Testing sample…" : "Test on recent mail"}
					</Button>
					<Button
						disabled={
							!validConfig ||
							(automatic && (!ready || (hasAI && !consent))) ||
							activate.isPending
						}
						onClick={() => activate.mutate()}
					>
						{activate.isPending ? "Activating…" : "Activate configuration"}
					</Button>
				</div>
				<p className="text-xs text-ink-muted">
					Activation saves a new immutable version. Existing messages are
					changed only by explicit reclassification. Test up to five messages;
					sample testing never changes their tags.
				</p>
				{preview.isError && (
					<p role="alert" className="text-danger">
						{preview.error.message}
					</p>
				)}
				{activate.isError && (
					<p role="alert" className="text-danger">
						{activate.error.message}
					</p>
				)}
				{activate.isSuccess && <p role="status">Configuration activated.</p>}
			</section>
			{comparison && (
				<section className={panel}>
					<h2 className="mb-3 font-medium">Sample comparison</h2>
					{comparison.fingerprint !== fingerprint && (
						<p role="status" className="mb-3 text-sm">
							Questions changed since this test. Test again to compare the
							current draft.
						</p>
					)}
					{comparison.sample.length === 0 && (
						<p>No eligible received mail in this scope.</p>
					)}
					{comparison.sample.map((sample) => (
						<article
							key={sample.messageId}
							className="space-y-2 border-t border-border py-3"
						>
							<p className="font-medium">{sample.subject || "(No subject)"}</p>
							<p className="text-sm">
								Current: {sample.current.join(", ") || "None"}
							</p>
							<p className="text-sm">
								Proposed:{" "}
								{sample.proposed.tags.map((t) => t.tag).join(", ") || "None"}
							</p>
							{sample.correction !== null && (
								<p className="text-sm">
									Your correction: {sample.correction.join(", ") || "No tags"}{" "}
									(preserved)
								</p>
							)}
							<p className="text-xs text-ink-muted">
								Uncertain: {sample.proposed.uncertain.join(", ") || "None"}
							</p>
							<details className="text-sm">
								<summary>Answers and probabilities</summary>
								<pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
									{JSON.stringify(sample.proposed.answers, null, 2)}
								</pre>
							</details>
						</article>
					))}
				</section>
			)}
		</div>
	);
}

function Processing({
	mailboxId,
	active,
}: {
	mailboxId: string | null;
	active: boolean;
}) {
	const qc = useQueryClient();
	const jobs = useQuery({
		queryKey: ["categorization-jobs"],
		queryFn: () => apiJson.get<Jobs>("/api/categorization/jobs"),
		refetchInterval: 5000,
		retry: false,
	});
	async function refresh() {
		await qc.invalidateQueries({ queryKey: ["categorization-jobs"] });
		await qc.invalidateQueries({ queryKey: ["mail-insights"] });
		await qc.invalidateQueries({ queryKey: labelKeys.all });
		await invalidateMessageQueries(qc);
	}
	const create = useMutation({
		mutationFn: () => apiJson.post("/api/categorization/jobs", { mailboxId }),
		onSuccess: refresh,
	});
	const advance = useMutation({
		mutationFn: ({ id, retry }: { id: string; retry: boolean }) =>
			apiJson.post(`/api/categorization/jobs/${id}`, { retry }),
		onSuccess: refresh,
	});
	const cancel = useMutation({
		mutationFn: (id: string) =>
			apiJson.patch(`/api/categorization/jobs/${id}`, { cancel: true }),
		onSuccess: refresh,
	});
	return (
		<div className={`${panel} space-y-4`}>
			<h2 className="font-medium">Process existing mail</h2>
			<p className="text-sm text-ink-muted">
				Use the active configuration on received and archived inbound mail in
				this mailbox scope. Personal corrections stay in place. Enabled AI
				questions disclose email content under the consent saved with that
				configuration.
			</p>
			<Button
				disabled={!active || create.isPending}
				onClick={() => create.mutate()}
			>
				Reclassify existing mail
			</Button>
			<p className="text-xs text-ink-muted">
				Each batch handles up to five messages. The background scheduler
				continues pending jobs every minute; you can process another batch here.
				Disabling automatic classification does not cancel an explicit backfill.
			</p>
			{jobs.isPending && <p role="status">Loading processing jobs…</p>}
			{jobs.isError && <p role="alert">{jobs.error.message}</p>}
			{jobs.data?.length === 0 && <p>No processing jobs yet.</p>}
			{jobs.data?.map((job) => (
				<article key={job.id} className="space-y-2 border-t border-border py-3">
					<div className="flex flex-wrap justify-between gap-2">
						<p className="font-medium">
							{job.automatic ? "New arrivals" : "Existing mail"} · {job.status}
						</p>
						<span className="text-sm tabular-nums">
							{job.processed} processed
						</span>
					</div>
					<p className="text-xs text-ink-muted">
						{job.mailboxId
							? `Mailbox ${job.mailboxId}`
							: "All accessible mailboxes"}{" "}
						· Configuration {job.versionId}
					</p>
					{job.error && (
						<p role="alert" className="text-sm text-danger">
							{job.error}
						</p>
					)}
					<div className="flex gap-2">
						{(job.status === "pending" ||
							job.status === "running" ||
							job.status === "failed") && (
							<>
								<Button
									size="sm"
									variant="outline"
									disabled={advance.isPending}
									onClick={() =>
										advance.mutate({
											id: job.id,
											retry: job.status === "failed",
										})
									}
								>
									{job.status === "failed" ? "Retry job" : "Process next batch"}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									disabled={cancel.isPending}
									onClick={() => cancel.mutate(job.id)}
								>
									Cancel job
								</Button>
							</>
						)}
					</div>
				</article>
			))}
			{[create.error, advance.error, cancel.error]
				.filter(Boolean)
				.map((error, i) => (
					<p role="alert" key={i} className="text-danger">
						{error!.message}
					</p>
				))}
		</div>
	);
}
