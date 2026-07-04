// @ts-ignore OpenNext generates this module during build.
import { default as nextHandler } from "./.open-next/worker.js";
import {
	processInboundMessage,
	storeRawToR2,
	type InboundQueueMessage,
} from "./src/lib/email/inbound";
import { processOutboundQueue, type OutboundQueueMessage } from "./src/lib/email/send";
import { isInboundQueueMessage } from "./worker-utils";

export default {
	fetch: nextHandler.fetch,

	async email(message: ForwardableEmailMessage, env: CloudflareEnv, ctx: ExecutionContext) {
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
				} else {
					await processOutboundQueue(env, msg.body as OutboundQueueMessage);
				}
				msg.ack();
			} catch (err) {
				console.error("Queue processing failed", err);
				msg.retry({ delaySeconds: 10 });
			}
		}
	},
} satisfies ExportedHandler<CloudflareEnv>;
