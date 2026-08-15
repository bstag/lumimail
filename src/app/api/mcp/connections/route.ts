import { withUser } from "@/lib/api/handler";
import { apiSuccess } from "@/lib/api/response";
import { listMcpConnections } from "@/lib/mcp/connections";

export const GET = withUser(async ({ env, user }) => apiSuccess(
	await listMcpConnections(env, user.id),
));
