import { guardOrgOwner } from "@/lib/auth/org-guard";
import { getEnv } from "@/lib/cloudflare";
import {
	readQueueHealthSnapshots,
	runQueueHealthCheck,
} from "@/lib/queue-health";

export async function GET(request: Request) {
	const env = getEnv();
	const { errorResponse } = await guardOrgOwner(env, request);
	if (errorResponse) return errorResponse;

	return Response.json({ queues: await readQueueHealthSnapshots(env) });
}

export async function POST(request: Request) {
	const env = getEnv();
	const { errorResponse } = await guardOrgOwner(env, request);
	if (errorResponse) return errorResponse;

	return Response.json({ queues: await runQueueHealthCheck(env) });
}
