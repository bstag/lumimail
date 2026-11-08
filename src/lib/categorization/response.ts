import { apiError, apiSuccess } from "@/lib/api/response";
import { CategorizationError } from "./service";
export async function categorizationResponse(work: () => Promise<unknown>) {
	try {
		return apiSuccess(await work());
	} catch (error) {
		return error instanceof CategorizationError
			? apiError(error.message, error.status)
			: apiError("Categorization is temporarily unavailable", 503);
	}
}
