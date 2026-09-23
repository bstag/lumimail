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
});

/**
 * Providers append their own parameters to the redirect (Google: `scope`, `authuser`,
 * `prompt`, `hd`, `iss`; Microsoft: `session_state`). Only a single `state` and a
 * single `code` are read; everything else is ignored and never trusted.
 */
function readCallbackParams(params: URLSearchParams) {
	const state = params.getAll("state");
	const code = params.getAll("code");
	if (state.length !== 1 || code.length !== 1) return null;
	const parsed = callbackSchema.safeParse({ state: state[0], code: code[0] });
	return parsed.success ? parsed.data : null;
}

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
	const callback = readCallbackParams(params);
	if (!callback) return settingsRedirect(origin, "error", "invalid");
	if (!user.organizationId) return settingsRedirect(origin, "error", "forbidden");
	const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
	const session = await readRecentlyAuthenticatedSession(env, user.id, sessionToken);
	if (!session || session.organizationId !== user.organizationId) {
		return settingsRedirect(origin, "error", "reauthenticate");
	}
	try {
		const result = await completeExternalOAuth(env, {
			userId: user.id,
			organizationId: user.organizationId,
			sessionId: session.id,
			...callback,
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
