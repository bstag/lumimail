import webpush from "web-push";

type PushProviderEnv = {
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
};

type PushDeliveryCredentials = {
	endpoint: string;
	p256dh: string;
	auth: string;
};

type PushProviderResult =
	| { outcome: "delivered" }
	| { outcome: "expired" }
	| { outcome: "failed" }
	| { outcome: "retry"; reason: "configuration" | "provider" | "network" };

function validVapidSubject(value: string | undefined): value is string {
	if (!value) return false;
	if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) return true;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function providerStatus(error: unknown): number | null {
	if (!error || typeof error !== "object") return null;
	const value = (error as { statusCode?: unknown }).statusCode;
	return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export async function sendPrivatePush(
	env: PushProviderEnv,
	device: PushDeliveryCredentials,
	input: { deliveryId: string; topic: string },
): Promise<PushProviderResult> {
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !validVapidSubject(env.VAPID_SUBJECT)) {
		return { outcome: "retry", reason: "configuration" };
	}

	try {
		await webpush.sendNotification({
			endpoint: device.endpoint,
			keys: { p256dh: device.p256dh, auth: device.auth },
		}, JSON.stringify({ notificationId: input.deliveryId }), {
			TTL: 300,
			urgency: "normal",
			contentEncoding: "aes128gcm",
			timeout: 10_000,
			topic: input.topic,
			vapidDetails: {
				subject: env.VAPID_SUBJECT,
				publicKey: env.VAPID_PUBLIC_KEY,
				privateKey: env.VAPID_PRIVATE_KEY,
			},
		});
		return { outcome: "delivered" };
	} catch (error) {
		const status = providerStatus(error);
		if (status === 404 || status === 410) return { outcome: "expired" };
		if (status === 429 || (status !== null && status >= 500 && status <= 599)) {
			return { outcome: "retry", reason: "provider" };
		}
		if (status !== null && status >= 400 && status <= 499) return { outcome: "failed" };
		return { outcome: "retry", reason: "network" };
	}
}
