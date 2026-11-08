import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	gte,
	inArray,
	isNull,
	lte,
	notExists,
	or,
	sql,
	type SQL,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb, type AppDatabase } from "@/db";
import {
	categorizationJobs as jobs,
	categorizationPreferences as preferences,
	categorizationResults as results,
	categorizationStates as states,
	categorizationVersions as versions,
	labels,
	messageLabels,
	messageBodies,
	messages,
	users,
} from "@/db/schema";
import {
	messageAccessCondition,
	getMailboxAccess,
} from "@/lib/auth/mailbox-access";
import { newId } from "@/lib/ids";
import {
	categorizationConfigSchema,
	type activateCategorizationSchema,
	type previewCategorizationSchema,
} from "@/lib/validators";
import type { z } from "zod";
import {
	DEFAULT_CONFIG,
	configuredTags,
	type CategoryEvaluation,
} from "./engine";
import { evaluateMail, isJevConfigured, type JevEnv } from "./jev";

export type CategoryActor = { id: string; organizationId: string | null };
export type CategoryEnv = CloudflareEnv & JevEnv;
export class CategorizationError extends Error {
	constructor(
		message: string,
		public status = 400,
	) {
		super(message);
	}
}
function org(column: AnySQLiteColumn, actor: CategoryActor) {
	return actor.organizationId
		? eq(column, actor.organizationId)
		: isNull(column);
}
function personal(
	table: { userId: AnySQLiteColumn; organizationId: AnySQLiteColumn },
	actor: CategoryActor,
) {
	return and(eq(table.userId, actor.id), org(table.organizationId, actor));
}
const epoch = new Date(0);

async function batch(db: AppDatabase, statements: BatchItem<"sqlite">[]) {
	await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

export async function readConfiguration(
	env: CategoryEnv,
	actor: CategoryActor,
) {
	const db = getDb(env);
	const [pref] = await db
		.select()
		.from(preferences)
		.where(personal(preferences, actor))
		.limit(1);
	const history = await db
		.select()
		.from(versions)
		.where(personal(versions, actor))
		.orderBy(desc(versions.createdAt), desc(versions.id))
		.limit(50);
	const active = history.find((v) => v.id === pref?.activeVersion);
	// Fetch active separately: rollback may reference a version outside the history page.
	const [selected] =
		pref && !active
			? await db
					.select()
					.from(versions)
					.where(
						and(personal(versions, actor), eq(versions.id, pref.activeVersion)),
					)
					.limit(1)
			: [];
	return {
		activeVersion: pref?.activeVersion ?? null,
		automatic: pref?.automatic ?? false,
		configured: isJevConfigured(env),
		config:
			active || selected
				? categorizationConfigSchema.parse(
						JSON.parse((active ?? selected).config),
					)
				: DEFAULT_CONFIG,
		versions: history.map((v) => ({
			id: v.id,
			createdAt: v.createdAt,
			config: categorizationConfigSchema.parse(JSON.parse(v.config)),
		})),
	};
}

export async function activateConfiguration(
	env: CategoryEnv,
	actor: CategoryActor,
	input: z.infer<typeof activateCategorizationSchema>,
) {
	const db = getDb(env);
	const [pref] = await db
		.select()
		.from(preferences)
		.where(personal(preferences, actor))
		.limit(1);
	if ((pref?.activeVersion ?? null) !== input.expectedVersion)
		throw new CategorizationError(
			"Configuration changed; reload before saving",
			409,
		);
	if (input.automatic && input.config.questions.some((q) => q.enabled)) {
		if (!input.consent)
			throw new CategorizationError(
				"Consent is required to send email content to TypeSafe",
			);
		if (!isJevConfigured(env))
			throw new CategorizationError("Jev API key is not configured", 503);
	}
	const now = new Date();
	const id = newId("cav");
	await db.insert(versions).values({
		id,
		userId: actor.id,
		organizationId: actor.organizationId,
		config: JSON.stringify(input.config),
		createdAt: now,
	});
	const settings = {
		activeVersion: id,
		automatic: input.automatic,
		aiConsent: input.consent,
		automaticSince: pref?.automatic ? pref.automaticSince : now,
		checkedAt: epoch,
	};
	const changed = pref
		? await db
				.update(preferences)
				.set(settings)
				.where(
					and(
						personal(preferences, actor),
						eq(preferences.activeVersion, input.expectedVersion!),
					),
				)
				.returning()
		: await db
				.insert(preferences)
				.values({
					userId: actor.id,
					organizationId: actor.organizationId,
					...settings,
				})
				.onConflictDoNothing()
				.returning();
	if (!changed.length) {
		await db.delete(versions).where(eq(versions.id, id));
		throw new CategorizationError(
			"Configuration changed; reload before saving",
			409,
		);
	}
	await db
		.update(jobs)
		.set({ status: "cancelled" })
		.where(
			and(
				personal(jobs, actor),
				eq(jobs.automatic, true),
				inArray(jobs.status, ["pending", "running", "failed"]),
			),
		);
	return readConfiguration(env, actor);
}

async function assertMailbox(
	db: AppDatabase,
	actor: CategoryActor,
	mailboxId: string | null,
) {
	if (
		mailboxId &&
		(!actor.organizationId ||
			!(await getMailboxAccess(db, actor.id, actor.organizationId, mailboxId)))
	)
		throw new CategorizationError("Mailbox not found", 404);
}

function inboundWhere(
	db: AppDatabase,
	actor: CategoryActor,
	mailboxId: string | null,
) {
	return and(
		sql`exists (select 1 from ${users} where ${users.id} = ${actor.id} and ${users.organizationId} is ${actor.organizationId})`,
		messageAccessCondition(db, actor.id, actor.organizationId, "read"),
		eq(messages.direction, "inbound"),
		inArray(messages.status, ["received", "archived"]),
		mailboxId ? eq(messages.mailboxId, mailboxId) : undefined,
	);
}
function mailSelection() {
	return {
		id: messages.id,
		fromAddr: messages.fromAddr,
		toAddr: messages.toAddr,
		subject: messages.subject,
		createdAt: messages.createdAt,
		text: sql<
			string | null
		>`substr(coalesce(${messageBodies.textBody}, ${messages.snippet}),1,8000)`,
	};
}

async function readableMessage(
	db: AppDatabase,
	actor: CategoryActor,
	messageId: string,
	mailboxId: string | null,
	lease?: SQL,
) {
	const [mail] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(
			and(
				inboundWhere(db, actor, mailboxId),
				eq(messages.id, messageId),
				lease ? sql`exists (select 1 from ${jobs} where ${lease})` : undefined,
			),
		)
		.limit(1);
	return Boolean(mail);
}

async function currentState(
	db: AppDatabase,
	actor: CategoryActor,
	messageId: string,
) {
	const [state] = await db
		.select()
		.from(states)
		.where(and(personal(states, actor), eq(states.messageId, messageId)))
		.limit(1);
	return state;
}
async function storedResult(
	db: AppDatabase,
	actor: CategoryActor,
	messageId: string,
	versionId: string,
): Promise<CategoryEvaluation | null> {
	const [result] = await db
		.select()
		.from(results)
		.where(
			and(
				personal(results, actor),
				eq(results.messageId, messageId),
				eq(results.versionId, versionId),
			),
		)
		.limit(1);
	return result ? JSON.parse(result.result) : null;
}

export async function previewConfiguration(
	env: CategoryEnv,
	actor: CategoryActor,
	input: z.infer<typeof previewCategorizationSchema>,
) {
	const db = getDb(env);
	await assertMailbox(db, actor, input.mailboxId);
	const sample = await db
		.select(mailSelection())
		.from(messages)
		.leftJoin(messageBodies, eq(messageBodies.messageId, messages.id))
		.where(inboundWhere(db, actor, input.mailboxId))
		.orderBy(desc(messages.createdAt), desc(messages.id))
		.limit(5);
	const comparison = [];
	for (const mail of sample) {
		if (!(await readableMessage(db, actor, mail.id, input.mailboxId))) continue;
		const state = await currentState(db, actor, mail.id);
		const proposed = await evaluateMail(env, input.config, mail);
		const [stillReadable] = await db
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(inboundWhere(db, actor, input.mailboxId), eq(messages.id, mail.id)),
			)
			.limit(1);
		if (!stillReadable) continue;
		comparison.push({
			messageId: mail.id,
			subject: mail.subject,
			fromAddr: mail.fromAddr,
			current: state ? (JSON.parse(state.tags) as string[]) : [],
			correction: state?.overrideTags
				? (JSON.parse(state.overrideTags) as string[])
				: null,
			proposed,
		});
	}
	return comparison;
}

export async function listJobs(env: CategoryEnv, actor: CategoryActor) {
	return getDb(env)
		.select({
			id: jobs.id,
			versionId: jobs.versionId,
			status: jobs.status,
			processed: jobs.processed,
			attempts: jobs.attempts,
			error: jobs.error,
			mailboxId: jobs.mailboxId,
			automatic: jobs.automatic,
			createdAt: jobs.createdAt,
		})
		.from(jobs)
		.where(personal(jobs, actor))
		.orderBy(desc(jobs.createdAt))
		.limit(30);
}
export async function createJob(
	env: CategoryEnv,
	actor: CategoryActor,
	mailboxId: string | null,
	automatic = false,
	now = new Date(),
) {
	const db = getDb(env);
	await assertMailbox(db, actor, mailboxId);
	const [active] = await db
		.select({ id: jobs.id })
		.from(jobs)
		.where(
			and(
				eq(jobs.userId, actor.id),
				inArray(jobs.status, ["pending", "running"]),
			),
		)
		.limit(1);
	if (active)
		throw new CategorizationError(
			"A classification job is already active",
			409,
		);
	const [pref] = await db
		.select()
		.from(preferences)
		.where(personal(preferences, actor))
		.limit(1);
	if (!pref) throw new CategorizationError("Activate a configuration first");
	const [version] = await db
		.select()
		.from(versions)
		.where(and(personal(versions, actor), eq(versions.id, pref.activeVersion)))
		.limit(1);
	const config = categorizationConfigSchema.parse(JSON.parse(version.config));
	if (config.questions.some((q) => q.enabled) && !pref.aiConsent)
		throw new CategorizationError(
			"Consent is required to send email content to TypeSafe",
		);
	if (config.questions.some((q) => q.enabled) && !isJevConfigured(env))
		throw new CategorizationError("Jev API key is not configured", 503);
	const job = {
		id: newId("caj"),
		userId: actor.id,
		organizationId: actor.organizationId,
		versionId: pref.activeVersion,
		mailboxId,
		automatic,
		status: "pending",
		since: automatic ? pref.automaticSince : epoch,
		cutoff: now,
		cursorAt: epoch,
		cursorId: "",
		processed: 0,
		attempts: 0,
		error: null,
		leaseToken: null,
		leaseUntil: epoch,
		createdAt: now,
	};
	const inserted = await db
		.insert(jobs)
		.values(job)
		.onConflictDoNothing()
		.returning({ id: jobs.id });
	if (!inserted.length)
		throw new CategorizationError(
			"A classification job is already active",
			409,
		);
	return job;
}

async function findJob(db: AppDatabase, actor: CategoryActor, id: string) {
	const [job] = await db
		.select()
		.from(jobs)
		.where(and(personal(jobs, actor), eq(jobs.id, id)))
		.limit(1);
	if (!job) throw new CategorizationError("Job not found", 404);
	return job;
}
export async function cancelJob(
	env: CategoryEnv,
	actor: CategoryActor,
	id: string,
) {
	const db = getDb(env);
	await findJob(db, actor, id);
	await db
		.update(jobs)
		.set({ status: "cancelled", leaseToken: null })
		.where(
			and(
				personal(jobs, actor),
				eq(jobs.id, id),
				inArray(jobs.status, ["pending", "running", "failed"]),
			),
		);
	return findJob(db, actor, id);
}

async function persistTags(
	db: AppDatabase,
	actor: CategoryActor,
	messageId: string,
	versionId: string,
	evaluation: CategoryEvaluation,
	override?: string[] | null,
	lease?: SQL,
) {
	const previous = await currentState(db, actor, messageId);
	// Each statement rechecks access and the state snapshot inside the atomic batch.
	// A cancellation, membership change, or concurrent correction makes the batch a no-op.
	const unchanged = previous
		? sql`exists (select 1 from ${states} where ${states.id} = ${previous.id} and ${states.versionId} = ${previous.versionId} and ${states.tags} = ${previous.tags} and ${states.appliedLabelIds} = ${previous.appliedLabelIds} and ${states.overrideTags} is ${previous.overrideTags})`
		: sql`not exists (select 1 from ${states} where ${states.userId} = ${actor.id} and ${states.messageId} = ${messageId})`;
	const eligible = and(
		eq(messages.id, messageId),
		inboundWhere(db, actor, null),
		unchanged,
		lease ? sql`exists (select 1 from ${jobs} where ${lease})` : undefined,
	);
	const guard = exists(
		db.select({ id: messages.id }).from(messages).where(eligible),
	);
	const overrideTags =
		override === undefined
			? (previous?.overrideTags ?? null)
			: override === null
				? null
				: JSON.stringify(override);
	const tags = [
		...new Set(
			overrideTags === null
				? evaluation.tags.map((t) => t.tag)
				: (JSON.parse(overrideTags) as string[]),
		),
	];
	const oldIds: string[] = previous ? JSON.parse(previous.appliedLabelIds) : [];
	const attachments = await db
		.select({ id: labels.id, name: labels.name })
		.from(messageLabels)
		.innerJoin(labels, eq(labels.id, messageLabels.labelId))
		.where(
			and(eq(messageLabels.messageId, messageId), eq(labels.userId, actor.id)),
		);
	const writes: BatchItem<"sqlite">[] = [];
	if (oldIds.length)
		writes.push(
			db
				.delete(messageLabels)
				.where(
					and(
						eq(messageLabels.messageId, messageId),
						inArray(messageLabels.labelId, oldIds),
						guard,
					),
				),
		);
	const ownedIds: string[] = [];
	for (const tag of tags) {
		await db
			.insert(labels)
			.values({
				id: newId("lbl"),
				userId: actor.id,
				organizationId: actor.organizationId,
				name: tag,
			})
			.onConflictDoNothing();
		const [label] = await db
			.select({ id: labels.id })
			.from(labels)
			.where(and(eq(labels.userId, actor.id), eq(labels.name, tag)))
			.limit(1);
		const manual = attachments.some(
			(a) => a.id === label.id && !oldIds.includes(a.id),
		);
		if (!manual) {
			ownedIds.push(label.id);
			writes.push(
				db
					.insert(messageLabels)
					.select(
						db
							.select({
								messageId: sql`${messageId}`.as("message_id"),
								labelId: sql`${label.id}`.as("label_id"),
							})
							.from(messages)
							.where(eligible),
					)
					.onConflictDoNothing(),
			);
		}
	}
	writes.push(
		db
			.insert(results)
			.select(
				db
					.select({
						id: sql`${newId("car")}`.as("id"),
						userId: sql`${actor.id}`.as("user_id"),
						organizationId: sql`${actor.organizationId}`.as("organization_id"),
						messageId: sql`${messageId}`.as("message_id"),
						versionId: sql`${versionId}`.as("version_id"),
						result: sql`${JSON.stringify(evaluation)}`.as("result"),
						createdAt: sql`${Math.floor(Date.now() / 1000)}`.as("created_at"),
					})
					.from(messages)
					.where(eligible),
			)
			.onConflictDoNothing(),
	);
	const state = {
		versionId,
		tags: JSON.stringify(tags),
		appliedLabelIds: JSON.stringify(ownedIds),
		overrideTags,
	};
	writes.push(
		db
			.insert(states)
			.select(
				db
					.select({
						id: sql`${newId("cas")}`.as("id"),
						userId: sql`${actor.id}`.as("user_id"),
						organizationId: sql`${actor.organizationId}`.as("organization_id"),
						messageId: sql`${messageId}`.as("message_id"),
						versionId: sql`${state.versionId}`.as("version_id"),
						tags: sql`${state.tags}`.as("tags"),
						appliedLabelIds: sql`${state.appliedLabelIds}`.as(
							"applied_label_ids",
						),
						overrideTags: sql`${state.overrideTags}`.as("override_tags"),
					})
					.from(messages)
					.where(eligible),
			)
			.onConflictDoUpdate({
				target: [states.userId, states.messageId],
				set: state,
				setWhere: guard,
			}),
	);
	await batch(db, writes);
}

export async function correctMessage(
	env: CategoryEnv,
	actor: CategoryActor,
	messageId: string,
	tags: string[] | null,
) {
	const db = getDb(env);
	const [mail] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(and(eq(messages.id, messageId), inboundWhere(db, actor, null)))
		.limit(1);
	const state = await currentState(db, actor, messageId);
	if (!mail || !state)
		throw new CategorizationError("Classification not found", 404);
	const evaluation = await storedResult(db, actor, messageId, state.versionId);
	if (!evaluation)
		throw new CategorizationError("Classification not found", 404);
	await persistTags(db, actor, messageId, state.versionId, evaluation, tags);
	return { tags: tags ?? evaluation.tags.map((t) => t.tag) };
}

export async function runJob(
	env: CategoryEnv,
	actor: CategoryActor,
	id: string,
	retry = false,
	now = new Date(),
) {
	const db = getDb(env);
	const initial = await findJob(db, actor, id);
	if (retry && initial.status === "failed") {
		const reset = await db
			.update(jobs)
			.set({ status: "pending", attempts: 0, leaseUntil: epoch, error: null })
			.where(
				and(
					personal(jobs, actor),
					eq(jobs.id, id),
					eq(jobs.status, "failed"),
					sql`not exists (select 1 from categorization_jobs as active_job where active_job.user_id = ${actor.id} and active_job.status in ('pending', 'running'))`,
				),
			)
			.returning({ id: jobs.id });
		if (!reset.length)
			throw new CategorizationError(
				"A classification job is already active",
				409,
			);
	}
	const token = newId("lease");
	const [job] = await db
		.update(jobs)
		.set({
			status: "running",
			leaseToken: token,
			leaseUntil: new Date(now.getTime() + 120000),
		})
		.where(
			and(
				personal(jobs, actor),
				eq(jobs.id, id),
				inArray(jobs.status, ["pending", "running"]),
				lte(jobs.leaseUntil, now),
			),
		)
		.returning();
	if (!job) return findJob(db, actor, id);
	const lease = and(
		personal(jobs, actor),
		eq(jobs.id, id),
		eq(jobs.leaseToken, token),
		eq(jobs.status, "running"),
	);
	try {
		await assertMailbox(db, actor, job.mailboxId);
		const [version] = await db
			.select()
			.from(versions)
			.where(and(personal(versions, actor), eq(versions.id, job.versionId)))
			.limit(1);
		const config = categorizationConfigSchema.parse(JSON.parse(version.config));
		const page = await db
			.select(mailSelection())
			.from(messages)
			.leftJoin(messageBodies, eq(messages.id, messageBodies.messageId))
			.where(
				and(
					inboundWhere(db, actor, job.mailboxId),
					gte(messages.createdAt, job.since),
					lte(messages.createdAt, job.cutoff),
					or(
						sql`${messages.createdAt} > ${Math.floor(job.cursorAt.getTime() / 1000)}`,
						and(
							eq(messages.createdAt, job.cursorAt),
							sql`${messages.id} > ${job.cursorId}`,
						),
					),
					job.automatic
						? notExists(
								db
									.select({ id: states.id })
									.from(states)
									.where(
										and(
											personal(states, actor),
											eq(states.messageId, messages.id),
										),
									),
							)
						: undefined,
				),
			)
			.orderBy(asc(messages.createdAt), asc(messages.id))
			.limit(5);
		for (const mail of page) {
			if (await readableMessage(db, actor, mail.id, job.mailboxId, lease)) {
				const evaluation =
					(await storedResult(db, actor, mail.id, job.versionId)) ??
					(await evaluateMail(env, config, mail));
				const [held] = await db
					.select({ id: jobs.id })
					.from(jobs)
					.where(lease)
					.limit(1);
				if (!held) return findJob(db, actor, id);
				const [readable] = await db
					.select({ id: messages.id })
					.from(messages)
					.where(
						and(
							inboundWhere(db, actor, job.mailboxId),
							eq(messages.id, mail.id),
						),
					)
					.limit(1);
				if (readable)
					await persistTags(
						db,
						actor,
						mail.id,
						job.versionId,
						evaluation,
						undefined,
						lease,
					);
			}
			await db
				.update(jobs)
				.set({
					cursorAt: mail.createdAt,
					cursorId: mail.id,
					processed: sql`${jobs.processed} + 1`,
					attempts: 0,
					error: null,
				})
				.where(lease);
		}
		await db
			.update(jobs)
			.set({
				status: page.length < 5 ? "complete" : "pending",
				leaseToken: null,
				leaseUntil: now,
			})
			.where(lease);
	} catch {
		const attempts = job.attempts + 1;
		await db
			.update(jobs)
			.set({
				status: attempts >= 3 ? "failed" : "pending",
				attempts,
				error:
					"Classification failed. Check provider configuration and mailbox access, then retry.",
				leaseToken: null,
				leaseUntil: new Date(now.getTime() + attempts * 60000),
			})
			.where(lease);
	}
	return findJob(db, actor, id);
}

export async function reconcileCategorization(
	env: CategoryEnv,
	now = new Date(),
) {
	const db = getDb(env);
	const enabled = await db
		.select({
			userId: preferences.userId,
			organizationId: preferences.organizationId,
			since: preferences.automaticSince,
		})
		.from(preferences)
		.innerJoin(users, eq(users.id, preferences.userId))
		.where(
			and(
				eq(preferences.automatic, true),
				sql`${users.organizationId} is ${preferences.organizationId}`,
			),
		)
		.orderBy(asc(preferences.checkedAt))
		.limit(2);
	for (const pref of enabled) {
		const actor = { id: pref.userId, organizationId: pref.organizationId };
		await db
			.update(preferences)
			.set({ checkedAt: now })
			.where(personal(preferences, actor));
		const [existing] = await db
			.select({ id: jobs.id })
			.from(jobs)
			.where(
				and(
					eq(jobs.userId, actor.id),
					or(
						inArray(jobs.status, ["pending", "running"]),
						and(eq(jobs.automatic, true), eq(jobs.status, "failed")),
					),
				),
			)
			.limit(1);
		const [waiting] = await db
			.select({ id: messages.id })
			.from(messages)
			.where(
				and(
					inboundWhere(db, actor, null),
					gte(messages.createdAt, pref.since),
					lte(messages.createdAt, now),
					notExists(
						db
							.select({ id: states.id })
							.from(states)
							.where(
								and(personal(states, actor), eq(states.messageId, messages.id)),
							),
					),
				),
			)
			.limit(1);
		if (!existing && waiting) {
			try {
				await createJob(env, actor, null, true, now);
			} catch {
				/* Missing key leaves mail untouched; settings shows readiness. */
			}
		}
	}
	const due = await db
		.select({
			id: jobs.id,
			userId: jobs.userId,
			organizationId: jobs.organizationId,
		})
		.from(jobs)
		.innerJoin(users, eq(users.id, jobs.userId))
		.where(
			and(
				inArray(jobs.status, ["pending", "running"]),
				lte(jobs.leaseUntil, now),
				sql`${users.organizationId} is ${jobs.organizationId}`,
			),
		)
		.orderBy(asc(jobs.leaseUntil), asc(jobs.createdAt))
		.limit(2);
	for (const job of due)
		await runJob(
			env,
			{ id: job.userId, organizationId: job.organizationId },
			job.id,
			false,
			now,
		);
}

// Split a JSON-quoted string safely, then take the final address bracket pair.
// Display names may themselves contain angle brackets or escaped quotes.
export const normalizedSender = sql<string>`lower(trim(case when instr(${messages.fromAddr}, '<') > 0 and substr(trim(${messages.fromAddr}), -1) = '>' then rtrim(json_extract('[' || replace(json_quote(trim(${messages.fromAddr})), '<', '","') || ']', '$[#-1]'), '>') else ${messages.fromAddr} end))`;
export async function readInsights(
	env: CategoryEnv,
	actor: CategoryActor,
	options: {
		days: number;
		mailboxId: string | null;
		sender: string | null;
		offset: number;
	},
	now = new Date(),
) {
	const db = getDb(env);
	await assertMailbox(db, actor, options.mailboxId);
	const received = sql<number>`coalesce(${messages.receivedAt}, ${messages.createdAt})`;
	const where = and(
		inboundWhere(db, actor, options.mailboxId),
		gte(received, Math.floor(now.getTime() / 1000) - options.days * 86400),
		lte(received, Math.floor(now.getTime() / 1000)),
		options.sender
			? eq(normalizedSender, options.sender.toLowerCase())
			: undefined,
	);
	const [total] = await db
		.select({ total: count() })
		.from(messages)
		.where(where);
	const senders = await db
		.select({ sender: normalizedSender, total: count() })
		.from(messages)
		.where(where)
		.groupBy(normalizedSender)
		.orderBy(desc(count()), asc(normalizedSender))
		.limit(26)
		.offset(options.offset);
	const week = sql<string>`strftime('%Y-%W', ${received}, 'unixepoch')`;
	const weekly = await db
		.select({ week, total: count() })
		.from(messages)
		.where(where)
		.groupBy(week)
		.orderBy(asc(week));
	const tags = await db
		.select({ id: labels.id, name: labels.name, total: count() })
		.from(messages)
		.innerJoin(messageLabels, eq(messages.id, messageLabels.messageId))
		.innerJoin(labels, eq(messageLabels.labelId, labels.id))
		.where(and(where, eq(labels.userId, actor.id)))
		.groupBy(labels.id)
		.orderBy(desc(count()))
		.limit(30);
	const recent = await db
		.select({
			id: messages.id,
			subject: messages.subject,
			fromAddr: messages.fromAddr,
			receivedAt: messages.receivedAt,
			createdAt: messages.createdAt,
			tags: states.tags,
			correction: states.overrideTags,
			versionId: states.versionId,
		})
		.from(messages)
		.leftJoin(
			states,
			and(eq(states.messageId, messages.id), personal(states, actor)),
		)
		.where(where)
		.orderBy(desc(received), desc(messages.id))
		.limit(25);
	const annotated = [];
	for (const mail of recent) {
		const evaluation = mail.versionId
			? await storedResult(db, actor, mail.id, mail.versionId)
			: null;
		annotated.push({
			...mail,
			tags: mail.tags ? (JSON.parse(mail.tags) as string[]) : [],
			correction: mail.correction
				? (JSON.parse(mail.correction) as string[])
				: null,
			evaluation,
		});
	}
	return {
		total: total.total,
		senders: senders.slice(0, 25),
		hasMore: senders.length > 25,
		offset: options.offset,
		weekly,
		tags,
		messages: annotated,
		suggestedTags: configuredTags((await readConfiguration(env, actor)).config),
	};
}
