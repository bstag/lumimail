import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users, organizationMembers, mailboxMemberships } from "@/db/schema";
import { withOrgAdmin } from "@/lib/api/handler";
import { apiSuccess, apiError, parseJsonBody } from "@/lib/api/response";
import { ORG_INVITE_ROLES } from "@/lib/constants";

const updateMemberRoleSchema = z.object({
  role: z.enum(ORG_INVITE_ROLES, { message: "Invalid role" }),
});

export const PATCH = withOrgAdmin<{ id: string }>(async ({ request, env, user, params }) => {
  const { id } = params;
  const { data, errorResponse } = await parseJsonBody(request, updateMemberRoleSchema);
  if (errorResponse) return errorResponse;
  const { role } = data;

  const db = getDb(env);
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, id), eq(organizationMembers.organizationId, user.organizationId)))
    .limit(1);

  if (!membership) return apiError("Member not found", 404);
  if (membership.role === "owner") return apiError("Cannot change the owner's role", 403);

  await db.update(organizationMembers).set({ role }).where(eq(organizationMembers.id, id));

  const [updated] = await db
    .select({ id: organizationMembers.id, userId: users.id, email: users.email, name: users.name, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.id, id))
    .limit(1);

  return apiSuccess({ member: updated });
});

export const DELETE = withOrgAdmin<{ id: string }>(async ({ env, user, params }) => {
  const { id } = params;
  const db = getDb(env);
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, id), eq(organizationMembers.organizationId, user.organizationId)))
    .limit(1);

  if (!membership) return apiError("Member not found", 404);
  if (membership.role === "owner") return apiError("Cannot remove the owner", 403);

  await db.batch([
    db.delete(mailboxMemberships).where(eq(mailboxMemberships.userId, membership.userId)),
    db.delete(organizationMembers).where(eq(organizationMembers.id, id)),
    db.update(users).set({ organizationId: null }).where(eq(users.id, membership.userId)),
  ]);

  return apiSuccess({ ok: true });
});
