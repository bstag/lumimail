import { withUser } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/response";
import {
	categorizationRunSchema,
	categorizationCancelSchema,
} from "@/lib/validators";
import { runJob, cancelJob } from "@/lib/categorization/service";
import { categorizationResponse } from "@/lib/categorization/response";
export const POST = withUser<{ id: string }>(
	async ({ env, user, request, params }) => {
		const { data, errorResponse } = await parseJsonBody(
			request,
			categorizationRunSchema,
		);
		if (errorResponse) return errorResponse;
		return categorizationResponse(() =>
			runJob(env, user, params.id, data.retry),
		);
	},
);
export const PATCH = withUser<{ id: string }>(
	async ({ env, user, request, params }) => {
		const { errorResponse } = await parseJsonBody(
			request,
			categorizationCancelSchema,
		);
		if (errorResponse) return errorResponse;
		return categorizationResponse(() => cancelJob(env, user, params.id));
	},
);
