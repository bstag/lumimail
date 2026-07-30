import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { guardOrgAdmin, guardOrgOwner } from "@/lib/auth/org-guard";
import { apiError } from "@/lib/api/response";
import type { User } from "@/db/schema";

/**
 * Route-handler wrappers collapsing the per-route preamble (resolve env,
 * authenticate, early-return 401/403) into one place, with guard failures in
 * the standard `{ success: false, error: { message } }` envelope.
 *
 * Next.js App Router passes dynamic segments as `{ params: Promise<P> }`;
 * the wrappers await it so handlers receive plain `params`.
 */
type RouteContext<P> = { params: Promise<P> };

type UserHandlerArgs<P> = {
	request: Request;
	env: CloudflareEnv;
	user: User;
	params: P;
};

type OrgHandlerArgs<P> = Omit<UserHandlerArgs<P>, "user"> & {
	user: User & { organizationId: string; role: string };
};

/** Any signed-in user (session cookie or bearer session token). */
export function withUser<P = Record<string, never>>(
	handler: (args: UserHandlerArgs<P>) => Promise<Response>,
): (request: Request, context?: RouteContext<P>) => Promise<Response> {
	return async (request, context) => {
		const env = getEnv();
		const user = await getCurrentUser(env, request);
		if (!user) return apiError("Unauthorized", 401);
		const params = context ? await context.params : ({} as P);
		return handler({ request, env, user, params });
	};
}

/** An organization owner or admin. */
export function withOrgAdmin<P = Record<string, never>>(
	handler: (args: OrgHandlerArgs<P>) => Promise<Response>,
): (request: Request, context?: RouteContext<P>) => Promise<Response> {
	return withOrgGuard(guardOrgAdmin, handler);
}

/** The organization owner only. */
export function withOrgOwner<P = Record<string, never>>(
	handler: (args: OrgHandlerArgs<P>) => Promise<Response>,
): (request: Request, context?: RouteContext<P>) => Promise<Response> {
	return withOrgGuard(guardOrgOwner, handler);
}

function withOrgGuard<P>(
	guard: typeof guardOrgAdmin,
	handler: (args: OrgHandlerArgs<P>) => Promise<Response>,
): (request: Request, context?: RouteContext<P>) => Promise<Response> {
	return async (request, context) => {
		const env = getEnv();
		const { orgUser, errorResponse } = await guard(env, request);
		if (errorResponse) {
			// Re-shape the guard's bare `{ error }` body into the envelope while
			// keeping its status (401 vs 403) authoritative.
			const status = errorResponse.status;
			return apiError(status === 403 ? "Forbidden" : "Unauthorized", status);
		}
		const params = context ? await context.params : ({} as P);
		return handler({ request, env, user: orgUser, params });
	};
}
