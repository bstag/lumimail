import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { resolvePushNotification } from "@/lib/push/resolver";

const PUSH_DELIVERY_ID = /^pudl_[A-Za-z0-9_-]{21}$/;

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ deliveryId: string }> },
) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.redirect(new URL("/login", request.url));
	const { deliveryId } = await params;
	if (!user.organizationId || !PUSH_DELIVERY_ID.test(deliveryId)) {
		return new Response("Not found", { status: 404 });
	}
	const resolved = await resolvePushNotification(env, {
		deliveryId,
		userId: user.id,
		organizationId: user.organizationId,
	});
	if (!resolved) return new Response("Not found", { status: 404 });
	return NextResponse.redirect(new URL(`/inbox/${encodeURIComponent(resolved.messageId)}`, request.url));
}
