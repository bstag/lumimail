"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type {
	CategoryQuestion,
	CategoryRule,
} from "@/lib/categorization/engine";

export function QuestionEditor({
	question: q,
	onChange,
	onRemove,
}: {
	question: CategoryQuestion;
	onChange: (q: CategoryQuestion) => void;
	onRemove: () => void;
}) {
	function changeType(type: CategoryQuestion["type"]) {
		const base = {
			key: q.key,
			name: q.name,
			instructions: q.instructions,
			enabled: q.enabled,
			threshold: q.threshold,
		};
		onChange(
			type === "choice"
				? {
						...base,
						type,
						options: [
							{ value: "Yes", description: "This category fits", tag: "Yes" },
							{
								value: "Other",
								description: "This category does not fit",
								tag: null,
							},
						],
					}
				: type === "noul"
					? { ...base, type, tag: null }
					: { ...base, type, levels: ["Low", "High"] },
		);
	}
	return (
		<fieldset className="space-y-4 rounded-lg border border-border p-4">
			<legend className="px-2 font-medium">{q.name}</legend>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={q.enabled}
						onChange={(e) => onChange({ ...q, enabled: e.target.checked })}
					/>
					Enabled
				</label>
				<Button variant="ghost" size="sm" onClick={onRemove}>
					Remove question
				</Button>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="space-y-1 text-sm">
					Question name
					<Input
						value={q.name}
						onChange={(e) => onChange({ ...q, name: e.target.value })}
					/>
				</label>
				<label className="space-y-1 text-sm">
					Answer type
					<Select
						value={q.type}
						onChange={(e) =>
							changeType(e.target.value as CategoryQuestion["type"])
						}
					>
						<option value="choice">Category choice</option>
						<option value="noul">Yes / no</option>
						<option value="score">Score</option>
					</Select>
				</label>
			</div>
			<label className="block space-y-1 text-sm">
				Question instructions
				<Textarea
					value={q.instructions}
					maxLength={2000}
					onChange={(e) => onChange({ ...q, instructions: e.target.value })}
				/>
			</label>
			<label className="block max-w-xs space-y-1 text-sm">
				Minimum probability for tagging
				<Input
					type="number"
					step="0.01"
					min="0.5"
					max="1"
					value={q.threshold}
					onChange={(e) =>
						onChange({ ...q, threshold: Number(e.target.value) })
					}
					disabled={q.type === "score"}
				/>
			</label>
			{q.type === "choice" && (
				<div className="space-y-3">
					{q.options.map((option, index) => (
						<div
							key={index}
							className="grid gap-2 rounded-md bg-surface p-3 sm:grid-cols-2"
						>
							<label className="space-y-1 text-sm">
								Answer value
								<Input
									value={option.value}
									onChange={(e) =>
										onChange({
											...q,
											options: q.options.map((o, i) =>
												i === index ? { ...o, value: e.target.value } : o,
											),
										})
									}
								/>
							</label>
							<label className="space-y-1 text-sm">
								Tag (blank for none)
								<Input
									value={option.tag ?? ""}
									onChange={(e) =>
										onChange({
											...q,
											options: q.options.map((o, i) =>
												i === index ? { ...o, tag: e.target.value || null } : o,
											),
										})
									}
								/>
							</label>
							<label className="space-y-1 text-sm sm:col-span-2">
								{option.value} definition
								<Textarea
									value={option.description}
									maxLength={500}
									onChange={(e) =>
										onChange({
											...q,
											options: q.options.map((o, i) =>
												i === index ? { ...o, description: e.target.value } : o,
											),
										})
									}
								/>
							</label>
							<Button
								variant="ghost"
								size="sm"
								disabled={q.options.length <= 2}
								onClick={() =>
									onChange({
										...q,
										options: q.options.filter((_, i) => i !== index),
									})
								}
							>
								Remove answer
							</Button>
						</div>
					))}
					<Button
						variant="outline"
						disabled={q.options.length >= 20}
						onClick={() =>
							onChange({
								...q,
								options: [
									...q.options,
									{
										value: `Answer ${q.options.length + 1}`,
										description: "Describe what belongs here",
										tag: null,
									},
								],
							})
						}
					>
						Add answer
					</Button>
				</div>
			)}
			{q.type === "noul" && (
				<label className="block space-y-1 text-sm">
					Tag when yes
					<Input
						value={q.tag ?? ""}
						onChange={(e) => onChange({ ...q, tag: e.target.value || null })}
					/>
				</label>
			)}
			{q.type === "score" && (
				<label className="block space-y-1 text-sm">
					Score levels (one per line, lowest first)
					<Textarea
						value={q.levels.join("\n")}
						onChange={(e) =>
							onChange({ ...q, levels: e.target.value.split("\n") })
						}
					/>
				</label>
			)}
		</fieldset>
	);
}

export function RuleEditor({
	rule,
	onChange,
	onRemove,
}: {
	rule: CategoryRule;
	onChange: (r: CategoryRule) => void;
	onRemove: () => void;
}) {
	return (
		<fieldset className="space-y-3 rounded-lg border border-border p-4">
			<legend className="px-2 font-medium">{rule.name}</legend>
			<div className="flex items-center justify-between gap-3">
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={rule.enabled}
						onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
					/>
					Enabled
				</label>
				<Button variant="ghost" size="sm" onClick={onRemove}>
					Remove rule
				</Button>
			</div>
			<label className="block space-y-1 text-sm">
				Rule name
				<Input
					value={rule.name}
					onChange={(e) => onChange({ ...rule, name: e.target.value })}
				/>
			</label>
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="space-y-1 text-sm">
					Sender match
					<Select
						value={rule.senderMode}
						onChange={(e) =>
							onChange({
								...rule,
								senderMode: e.target.value as CategoryRule["senderMode"],
							})
						}
					>
						<option value="exact">Exact email address</option>
						<option value="domain">Exact domain</option>
					</Select>
				</label>
				<label className="space-y-1 text-sm">
					Sender
					<Input
						value={rule.sender}
						onChange={(e) => onChange({ ...rule, sender: e.target.value })}
					/>
				</label>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="space-y-1 text-sm">
					Subject contains
					<Input
						value={rule.subject}
						onChange={(e) => onChange({ ...rule, subject: e.target.value })}
					/>
				</label>
				<label className="space-y-1 text-sm">
					Body contains
					<Input
						value={rule.words}
						onChange={(e) => onChange({ ...rule, words: e.target.value })}
					/>
				</label>
			</div>
			<label className="block space-y-1 text-sm">
				Apply tag
				<Input
					value={rule.tag}
					onChange={(e) => onChange({ ...rule, tag: e.target.value })}
				/>
			</label>
			<p className="text-xs text-ink-muted">
				All filled conditions must match. Keep messages in their current
				folders.
			</p>
		</fieldset>
	);
}
