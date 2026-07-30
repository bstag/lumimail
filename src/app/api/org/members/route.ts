import { eq, and, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { users, organizationMembers, orgInvites } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { hashInvitationToken } from "@/lib/auth/invitation";
import { newId } from "@/lib/ids";
import { apiSuccess, apiError } from "@/lib/api/response";
import { organizationInviteSchema } from "@/lib/validators";

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

  const invites = await db
    .select({
      id: orgInvites.id,
      email: orgInvites.email,
      role: orgInvites.role,
      expiresAt: orgInvites.expiresAt,
      createdAt: orgInvites.createdAt,
    })
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.organizationId, user.organizationId),
        gt(orgInvites.expiresAt, new Date()),
      ),
    );

  return apiSuccess({ members, invites });
});

export const POST = withOrgAdmin(async ({ request, env, user }) => {
  const parsed = organizationInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Invalid invitation", 400);
  const { email: inviteEmail, role } = parsed.data;

  const db = getDb(env);

  const [existingMember] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(
      and(
        eq(organizationMembers.organizationId, user.organizationId),
        eq(users.email, inviteEmail),
      ),
    )
    .limit(1);

  if (existingMember) return apiError("Already a member", 409);

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, inviteEmail))
    .limit(1);
  if (existingUser) return apiError("Email already registered", 409);

  const [existingInvite] = await db
    .select({ id: orgInvites.id })
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.organizationId, user.organizationId),
        eq(orgInvites.email, inviteEmail),
        gt(orgInvites.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const token = newId("tok");
  const tokenHash = await hashInvitationToken(token);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  if (existingInvite) {
    await db
      .update(orgInvites)
      .set({ role, token: tokenHash, expiresAt })
      .where(eq(orgInvites.id, existingInvite.id));

    return apiSuccess({ invite: { id: existingInvite.id, token } });
  }

  const inviteId = newId("inv");
  await db.insert(orgInvites).values({
    id: inviteId,
    organizationId: user.organizationId,
    email: inviteEmail,
    role,
    token: tokenHash,
    expiresAt,
  });

  return apiSuccess({ invite: { id: inviteId, token } });
});
