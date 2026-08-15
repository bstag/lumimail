import { and, eq, isNull } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { orgInvites, organizations } from "@/db/schema";
import { hashInvitationToken } from "@/lib/auth/invitation";
import { apiSuccess, apiError } from "@/lib/api/response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params;
  const tokenHash = await hashInvitationToken(identifier);
  const env = getEnv();
  const db = getDb(env);

  const [invite] = await db
    .select({
      id: orgInvites.id,
      email: orgInvites.email,
      role: orgInvites.role,
      expiresAt: orgInvites.expiresAt,
      organizationId: orgInvites.organizationId,
      orgName: organizations.name,
    })
    .from(orgInvites)
    .innerJoin(organizations, eq(orgInvites.organizationId, organizations.id))
    .where(and(eq(orgInvites.token, tokenHash), isNull(orgInvites.acceptedAt)))
    .limit(1);

  if (!invite) return apiError("Invite not found", 404);
  if (new Date(invite.expiresAt) < new Date()) return apiError("Invite has expired", 410);
  return apiSuccess({ email: invite.email, orgName: invite.orgName, role: invite.role });
}
