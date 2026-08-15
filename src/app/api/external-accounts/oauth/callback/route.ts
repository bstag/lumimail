import { cookies } from "next/headers";
import { z } from "zod";
import { withUser } from "@/lib/api/handler";
import { apiError } from "@/lib/api/response";
import { readRecentlyAuthenticatedSession } from "@/lib/auth/recent-auth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { completeExternalOAuth } from "@/lib/email/external/connections";
import { normalizePublicAppOrigin } from "@/lib/email/external/oauth-provider";

const callbackSchema = z.object({
	state: z.string().min(1).max(256),
	code: z.string().min(1).max(4096),
}).strict();

function settingsRedirect(origin: string, name: "connected" | "error", value: string): Response {
	const target = new URL("/settings/external-accounts", origin);
	target.searchParams.set(name, value);
	return Response.redirect(target, 303);
}

export const GET = withUser(async ({ request, env, user }) => {
	let origin: string;
	try {
		origin = normalizePublicAppOrigin(env.PUBLIC_APP_URL);
	} catch {
		return apiError("External OAuth is unavailable", 503);
	}
	const params = new URL(request.url).searchParams;
	if (params.has("error")) return settingsRedirect(origin, "error", "provider-denied");
	const values = Object.fromEntries(params.entries());
	const parsed = callbackSchema.safeParse(values);
	if (!parsed.success || [...params.keys()].length !== 2) {
		return settingsRedirect(origin, "error", "invalid");
	}
	if (!user.organizationId) return apiError("No active organization", 403);
	const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
	const session = await readRecentlyAuthenticatedSession(env, user.id, sessionToken);
	if (!session || session.organizationId !== user.organizationId) {
		return apiError("Recent authentication required", 403);
	}
	try {
		const result = await completeExternalOAuth(env, {
			userId: user.id,
			organizationId: user.organizationId,
			sessionId: session.id,
			...parsed.data,
		});
		if (result.status === "created") return settingsRedirect(origin, "connected", result.accountId);
		const error = result.status === "conflict"
			? "already-connected"
			: result.status === "forbidden" ? "forbidden" : "invalid";
		return settingsRedirect(origin, "error", error);
	} catch {
		return settingsRedirect(origin, "error", "unavailable");
	}
});
