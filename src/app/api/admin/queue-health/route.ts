import { withOrgOwner } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import {
	readQueueHealthSnapshots,
	runQueueHealthCheck,
} from "@/lib/queue-health";

export const GET = withOrgOwner(async ({ env }) => {
	return apiSuccess({ queues: await readQueueHealthSnapshots(env) });
});

export const POST = withOrgOwner(async ({ env }) => {
	return apiSuccess({ queues: await runQueueHealthCheck(env) });
});
