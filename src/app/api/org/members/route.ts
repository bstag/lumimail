import { eq, and, gt } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { users, organizationMembers, orgInvites } from "@/db/schema";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { hashInvitationToken } from "@/lib/auth/invitation";
import { newId } from "@/lib/ids";
import { apiSuccess, apiError } from "@/lib/api/response";
import { organizationInviteSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const env = getEnv();
  const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
  if (errorResponse) return errorResponse;

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
    .where(eq(organizationMembers.organizationId, orgUser.organizationId as string));

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
        eq(orgInvites.organizationId, orgUser.organizationId as string),
        gt(orgInvites.expiresAt, new Date()),
      ),
    );

  return apiSuccess({ members, invites });
}

export async function POST(request: Request) {
  const env = getEnv();
  const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
  if (errorResponse) return errorResponse;

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
        eq(organizationMembers.organizationId, orgUser.organizationId as string),
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
        eq(orgInvites.organizationId, orgUser.organizationId as string),
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
    organizationId: orgUser.organizationId as string,
    email: inviteEmail,
    role,
    token: tokenHash,
    expiresAt,
  });

  return apiSuccess({ invite: { id: inviteId, token } });
}
