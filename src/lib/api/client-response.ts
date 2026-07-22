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

export async function parseApiResponse<T>(response: Response): Promise<T> {
	let body: unknown;

	try {
		body = await response.json();
	} catch {
		throw invalidResponse(response.status);
	}

	if (!isRecord(body)) throw invalidResponse(response.status);

	if (body.success === true) {
		if (!response.ok || !("data" in body)) throw invalidResponse(response.status);
		return body.data as T;
	}

	if (body.success === false && isRecord(body.error)) {
		const message = body.error.message;
		if (typeof message === "string" && message.trim().length > 0) {
			throw new ApiResponseError(message, response.status);
		}
	}

	throw invalidResponse(response.status);
}
