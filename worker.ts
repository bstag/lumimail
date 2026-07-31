// @ts-ignore OpenNext generates this module during build.
import { default as nextHandler } from "./.open-next/worker.js";
import {
	processInboundMessage,
	storeRawToR2,
	type InboundQueueMessage,
} from "./src/lib/email/inbound";
import {
	processOutboundDeadLetter,
	processOutboundQueue,
} from "./src/lib/email/outbound/consumer";
import {
	isInboundQueueMessage,
	isOutboundDeadLetterQueue,
	isOutboundQueueMessage,
} from "./worker-utils";
import { runQueueHealthCheck } from "./src/lib/queue-health";
import { purgeExpiredRateLimits } from "./src/lib/rate-limit";
import { RETRY_DELAY_SECONDS } from "./src/lib/constants";
import { deleteR2Orphans, shouldRunSweep } from "./src/lib/r2-retention";
import { getDb } from "./src/db";
import { resolveInboundTargets } from "./src/lib/email/routing";
import {
	forwardInbound,
	shouldRejectUndeliverable,
} from "./src/lib/email/forwarding";

export default {
	fetch: nextHandler.fetch,

	async email(message: ForwardableEmailMessage, env: CloudflareEnv, ctx: ExecutionContext) {
		// Forwarding must happen here: `message.forward()` exists only on the live
		// inbound message, and by the time the queue consumer resolves routing the
		// forwarding capability is gone.
		let forwarding: Awaited<ReturnType<typeof forwardInbound>> | null = null;
		let decisions: Awaited<ReturnType<typeof resolveInboundTargets>> = [];
		try {
			decisions = await resolveInboundTargets(getDb(env), message.to);
			forwarding = await forwardInbound(getDb(env), message, decisions);

			if (forwarding.refused.length > 0 || forwarding.failed.length > 0) {
				console.warn("Inbound forwarding not delivered", {
					refused: forwarding.refused.map((entry) => entry.reason),
					failed: forwarding.failed.length,
				});
			}
		} catch (err) {
			// A routing or forwarding fault must not make Lumimail worse than it was
			// before forwarding existed, so fall through to the ordinary store path.
			console.error("Inbound forwarding failed", err);
		}

		if (forwarding && shouldRejectUndeliverable(decisions, forwarding)) {
			message.setReject("Forwarding destination unavailable");
			return;
		}

		try {
			const rawR2Key = await storeRawToR2(env, message.from, message.to, message.raw);
			const payload: InboundQueueMessage = {
				from: message.from,
				to: message.to,
				rawR2Key,
				headers: Object.fromEntries(message.headers),
			};
			await env.INBOUND_QUEUE.send(payload);
		} catch (err) {
			console.error("Inbound enqueue failed", err);
			message.setReject("Processing failed");
		}
	},

	async queue(batch: MessageBatch, env: CloudflareEnv): Promise<void> {
		for (const msg of batch.messages) {
			try {
				if (isInboundQueueMessage(msg.body)) {
					await processInboundMessage(env, msg.body);
					msg.ack();
				} else if (isOutboundQueueMessage(msg.body)) {
					if (isOutboundDeadLetterQueue(batch.queue)) {
						await processOutboundDeadLetter(env, msg.body);
						msg.ack();
						continue;
					}
					const result = await processOutboundQueue(env, msg.body, msg.id);
					if (result.action === "retry") {
						msg.retry({ delaySeconds: result.delaySeconds });
					} else {
						msg.ack();
					}
				} else {
					console.error("Queue payload rejected", {
						queue: batch.queue,
						messageId: msg.id,
					});
					msg.ack();
				}
			} catch (err) {
				console.error("Queue processing failed", {
					queue: batch.queue,
					messageId: msg.id,
					error: err instanceof Error ? err.message : "Unknown error",
				});
				msg.retry({ delaySeconds: RETRY_DELAY_SECONDS });
			}
		}
	},

	async scheduled(
		controller: ScheduledController,
		env: CloudflareEnv,
	): Promise<void> {
		await runQueueHealthCheck(env);

		// Expired counters are ignored by the rate-limit check itself; this purge
		// only keeps the table from growing without bound (F74). It swallows its
		// own failures, so it cannot block the sweep below.
		await purgeExpiredRateLimits(env);

		// Ships disabled. The existing production backlog would otherwise be removed
		// on the first run, before an operator has seen the report (F63).
		if (env.R2_SWEEP_ENABLED === "true" && shouldRunSweep(controller.scheduledTime)) {
			const result = await deleteR2Orphans(env, { limit: 100 });
			if (result.deleted > 0 || result.remaining > 0) {
				console.info("R2 retention sweep", result);
			}
		}
	},
} satisfies ExportedHandler<CloudflareEnv>;
