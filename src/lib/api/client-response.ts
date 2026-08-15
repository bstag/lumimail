import { authFetch } from "@/lib/auth/client";

export type ApiSuccessResponse<T> = {
	success: true;
	data: T;
};

export type ApiErrorResponse = {
	success: false;
	error: {
		message: string;
	};
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export class ApiResponseError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiResponseError";
		this.status = status;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(status: number): ApiResponseError {
	return new ApiResponseError("Invalid API response", status);
}

/**
 * Extracts a displayable message from either error shape.
 *
 * `{ success: false, error: { message } }` is the canonical envelope from F40.
 * The bare `{ error: "..." }` string is still produced by `guardUser` and the
 * pre-envelope routes, so both must be understood or an authentication failure
 * would surface as a generic error.
 */
function readErrorMessage(body: unknown): string | null {
	if (!isRecord(body) || !("error" in body)) return null;
	const error = body.error;
	if (typeof error === "string") {
		return error.trim().length > 0 ? error : null;
	}
	if (isRecord(error) && typeof error.message === "string" && error.message.trim().length > 0) {
		return error.message;
	}
	return null;
}

export type ParseApiResponseOptions = {
	/**
	 * Accept a non-enveloped 2xx JSON body and return it as-is. T-33 migrated
	 * every route to the F40 envelope except the documented session-bootstrap
	 * exception set, which deliberately stays flat: `/api/auth/login`,
	 * `/api/auth/register`, `/api/auth/me`, `/api/auth/logout`, and
	 * `/api/setup/status`. `apiJson` keeps this enabled so those routes (and
	 * any e2e mock that still fulfills a bare body) pass through unchanged.
	 * Strict callers (the default) reject bare bodies.
	 */
	allowBareBody?: boolean;
};

export async function parseApiResponse<T>(
	response: Response,
	options: ParseApiResponseOptions = {},
): Promise<T> {
	let body: unknown;

	try {
		body = await response.json();
	} catch {
		throw invalidResponse(response.status);
	}

	if (isRecord(body) && body.success === true && "data" in body) {
		if (!response.ok) throw invalidResponse(response.status);
		return body.data as T;
	}

	const message = readErrorMessage(body);
	if (message !== null) throw new ApiResponseError(message, response.status);

	if (options.allowBareBody === true && response.ok) return body as T;

	throw invalidResponse(response.status);
}

async function requestJson<T>(method: string, url: string, body?: unknown): Promise<T> {
	const init: RequestInit = { method };
	if (body !== undefined) {
		init.headers = { "Content-Type": "application/json" };
		init.body = JSON.stringify(body);
	}
	const response = await authFetch(url, init);
	return parseApiResponse<T>(response, { allowBareBody: true });
}

/**
 * Thin JSON client over `authFetch` + `parseApiResponse`.
 *
 * Unwraps the F40 envelope when present, passes pre-envelope bodies through
 * unchanged, and throws `ApiResponseError` with the server's message (either
 * error shape) on failure. Callers that need the raw `Response` (redirect
 * handling, blobs) should keep using `authFetch` directly.
 */
export const apiJson = {
	get: <T>(url: string): Promise<T> => requestJson<T>("GET", url),
	post: <T>(url: string, body?: unknown): Promise<T> => requestJson<T>("POST", url, body),
	put: <T>(url: string, body?: unknown): Promise<T> => requestJson<T>("PUT", url, body),
	patch: <T>(url: string, body?: unknown): Promise<T> => requestJson<T>("PATCH", url, body),
	delete: <T>(url: string, body?: unknown): Promise<T> => requestJson<T>("DELETE", url, body),
};
