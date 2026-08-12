import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, organizationMembers } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiSuccess, apiError } from "@/lib/api/response";
import { organizationInviteSchema } from "@/lib/validators";
import { createOrganizationInvitation, listOrganizationInvitations } from "@/lib/organization-invitations";

export const GET = withOrgAdmin(async ({ env, user }) => {
  const db = getDb(env);
  const members = await db
    .select({
      id: organizationMembers.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: organizationMembers.role,
      createdAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, user.organizationId));

  const invites = await listOrganizationInvitations(env, user.organizationId);

  return apiSuccess({ members, invites });
});

export const POST = withOrgAdmin(async ({ request, env, user }) => {
  const parsed = organizationInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Invalid invitation", 400);
  const { email: inviteEmail, role } = parsed.data;

  let result: Awaited<ReturnType<typeof createOrganizationInvitation>>;
  try {
    result = await createOrganizationInvitation(env, {
      organizationId: user.organizationId,
      email: inviteEmail,
      role,
    });
  } catch {
    console.error(JSON.stringify({ message: "organization invitation creation failed" }));
    return apiError("Invitation service temporarily unavailable", 503);
  }
  switch (result.status) {
    case "already-member": return apiError("Already a member", 409);
    case "email-registered": return apiError("Email already registered", 409);
    case "rate-limited": return apiError("Please wait before sending another invitation", 429);
    case "unavailable": return apiError("Invitation service temporarily unavailable", 503);
    case "created": return apiSuccess({ invite: {
      id: result.inviteId,
      token: result.token,
      deliveryStatus: result.deliveryStatus,
    } });
  }
});
