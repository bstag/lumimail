import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMessageWithBody } from "@/lib/email/inbound";

type MessageRouteParams = {
	params: Promise<{ messageId: string }>;
};

export async function GET(request: Request, { params }: MessageRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { messageId } = await params;
	const data = await getMessageWithBody(env, user.id, user.organizationId, messageId);
	if (!data) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	return NextResponse.json(data);
}
