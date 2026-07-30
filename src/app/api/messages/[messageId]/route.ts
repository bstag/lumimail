import { NextResponse } from "next/server";
import { withUser } from "@/lib/api/handler";
import { getMessageWithBody } from "@/lib/messages/queries";

export const GET = withUser<{ messageId: string }>(async ({ env, user, params }) => {
	const { messageId } = params;
	const data = await getMessageWithBody(env, user.id, user.organizationId, messageId);
	if (!data) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	return NextResponse.json(data);
});
