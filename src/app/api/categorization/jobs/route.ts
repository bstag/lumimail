import { withUser } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/response";
import { categorizationJobSchema } from "@/lib/validators";
import { createJob, listJobs } from "@/lib/categorization/service";
import { categorizationResponse } from "@/lib/categorization/response";
export const GET = withUser(async ({ env, user }) =>
	categorizationResponse(() => listJobs(env, user)),
);
export const POST = withUser(async ({ env, user, request }) => {
	const { data, errorResponse } = await parseJsonBody(
		request,
		categorizationJobSchema,
	);
	if (errorResponse) return errorResponse;
	return categorizationResponse(() => createJob(env, user, data.mailboxId));
});
