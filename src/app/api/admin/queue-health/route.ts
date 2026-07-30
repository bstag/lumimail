import { withOrgOwner } from "@/lib/api/handler";
import {
	readQueueHealthSnapshots,
	runQueueHealthCheck,
} from "@/lib/queue-health";

export const GET = withOrgOwner(async ({ env }) => {
	return Response.json({ queues: await readQueueHealthSnapshots(env) });
});

export const POST = withOrgOwner(async ({ env }) => {
	return Response.json({ queues: await runQueueHealthCheck(env) });
});
