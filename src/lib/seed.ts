import {
	ensureDemoDomain,
	ensureDemoMailboxes,
	ensureDemoUser,
	insertDemoMessages,
} from "@/lib/seed-utils";
import { ensureUserOrg } from "@/lib/migration/backfill-orgs";

/** Dev-only seed without Cloudflare API (domain must be onboarded separately). */
export async function seedDemoData(env: CloudflareEnv): Promise<{ messageCount: number }> {
	const user = await ensureDemoUser(env);
	// ensureUserOrg still owns creating the org + owner membership (and stamping
	// the user's active-org pointer); the inserts below carry organizationId
	// directly instead of relying on any backfill (T-43).
	const organizationId = await ensureUserOrg(env, user.id);
	const domain = await ensureDemoDomain(env, user.id, organizationId);
	const mailboxMap = await ensureDemoMailboxes(env, user.id, organizationId, domain.id);
	const messageCount = await insertDemoMessages(env, user.id, organizationId, mailboxMap);

	return { messageCount };
}
