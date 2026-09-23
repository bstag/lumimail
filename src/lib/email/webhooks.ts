import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { newId } from "@/lib/ids";

export type WebhookEventType = "message.inbound" | "message.outbound" | "message.failed";

export async function dispatchWebhooks(
	env: CloudflareEnv,
	userId: string,
	eventType: WebhookEventType,
	payload: Record<string, unknown>,
): Promise<void> {
	const db = getDb(env);
	const hooks = await db.select().from(webhooks).where(eq(webhooks.userId, userId));

	for (const hook of hooks) {
		if (!hook.enabled) continue;
		let events: string[] = [];
		try {
			const value: unknown = JSON.parse(hook.events);
			if (!Array.isArray(value)) continue;
			events = value;
		} catch {
			continue;
		}
		if (!events.includes(eventType)) continue;

		const deliveryId = newId();
		const body = JSON.stringify({ type: eventType, data: payload });
		await db.insert(webhookDeliveries).values({
			id: deliveryId,
			webhookId: hook.id,
			eventType,
			payload: body,
			status: "pending",
			attempts: 0,
			nextAttemptAt: new Date(),
		});
	}
}

const MAX_ATTEMPTS = 3;
const RETRY_MS = 60_000;
const DEADLINE_MS = 5_000;
type Delivery = typeof webhookDeliveries.$inferSelect;
type Hook = typeof webhooks.$inferSelect;

async function postWebhook(hook: Hook, delivery: Delivery): Promise<"delivered" | "pending" | "failed"> {
	const signature = await signPayload(hook.secret, delivery.payload);
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error("Webhook deadline exceeded"));
		}, DEADLINE_MS);
	});
	try {
		const response = await Promise.race([fetch(hook.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Email-Platform-Signature": signature,
				"X-Email-Platform-Event": delivery.eventType,
				"X-Email-Platform-Delivery": delivery.id,
			},
			body: delivery.payload,
			signal: controller.signal,
			redirect: "error",
		}), deadline]);
		// The endpoint's body is irrelevant; never buffer it or hold an open connection.
		if (response.body) await Promise.race([response.body.cancel(), deadline]);
		if (response.ok) return "delivered";
		return response.status === 429 || response.status >= 500 ? "pending" : "failed";
	} catch {
		return "pending";
	} finally {
		clearTimeout(timer!);
	}
}

async function deliverWebhook(env: CloudflareEnv, candidate: Delivery, now: Date): Promise<void> {
	const db = getDb(env);
	const attempts = Math.min(candidate.attempts + 1, MAX_ATTEMPTS);
	const [delivery] = await db.update(webhookDeliveries).set({
		attempts,
		nextAttemptAt: new Date(now.getTime() + RETRY_MS),
	}).where(and(
		eq(webhookDeliveries.id, candidate.id),
		eq(webhookDeliveries.status, "pending"),
		eq(webhookDeliveries.attempts, candidate.attempts),
		lte(webhookDeliveries.nextAttemptAt, now),
	)).returning();
	if (!delivery) return;
	const [hook] = await db.select().from(webhooks).where(and(
		eq(webhooks.id, delivery.webhookId), eq(webhooks.enabled, true),
	)).limit(1);
	const outcome = hook && candidate.attempts < MAX_ATTEMPTS ? await postWebhook(hook, delivery) : "failed";
	const status = outcome === "pending" && attempts >= MAX_ATTEMPTS ? "failed" : outcome;
	await db.update(webhookDeliveries).set({ status }).where(and(
		eq(webhookDeliveries.id, delivery.id),
		eq(webhookDeliveries.status, "pending"),
		eq(webhookDeliveries.attempts, attempts),
	));
}

/** Independent scheduled jobs: slow subscribers never occupy the mail queue consumer. */
export async function processDueWebhooks(env: CloudflareEnv, now = new Date()): Promise<void> {
	const rows = await getDb(env).select().from(webhookDeliveries).where(and(
		eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, now),
	)).orderBy(webhookDeliveries.nextAttemptAt).limit(10);
	for (let index = 0; index < rows.length; index += 3) {
		const results = await Promise.allSettled(rows.slice(index, index + 3).map((row) => deliverWebhook(env, row, now)));
		if (results.some((result) => result.status === "rejected")) console.warn("Webhook delivery storage failed");
	}
}

async function signPayload(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
