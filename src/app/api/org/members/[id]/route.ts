import { eq, and } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { users, organizationMembers, mailboxMemberships } from "@/db/schema";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { apiSuccess, apiError } from "@/lib/api/response";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const env = getEnv();
  const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
  if (errorResponse) return errorResponse;

  const body = await request.json() as Record<string, unknown>;
  const role = body.role;
  if (role !== "admin" && role !== "member") return apiError("Invalid role", 400);

  const db = getDb(env);
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, id), eq(organizationMembers.organizationId, orgUser.organizationId as string)))
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
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const env = getEnv();
  const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
  if (errorResponse) return errorResponse;

  const db = getDb(env);
  const [membership] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.id, id), eq(organizationMembers.organizationId, orgUser.organizationId as string)))
    .limit(1);

  if (!membership) return apiError("Member not found", 404);
  if (membership.role === "owner") return apiError("Cannot remove the owner", 403);

  await db.batch([
    db.delete(mailboxMemberships).where(eq(mailboxMemberships.userId, membership.userId)),
    db.delete(organizationMembers).where(eq(organizationMembers.id, id)),
    db.update(users).set({ organizationId: null }).where(eq(users.id, membership.userId)),
  ]);

  return apiSuccess({ ok: true });
}
