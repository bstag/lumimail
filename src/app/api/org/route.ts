import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { organizations } from "@/db/schema";
import { guardOrgAdmin } from "@/lib/auth/org-guard";
import { apiSuccess, apiError } from "@/lib/api/response";

export async function GET(request: Request) {
  const env = getEnv();
  const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
  if (errorResponse) return errorResponse;

  const db = getDb(env);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgUser.organizationId)).limit(1);
  if (!org) return apiError("Organization not found", 404);

  return apiSuccess({ organization: org });
}

export async function PATCH(request: Request) {
  const env = getEnv();
  const { orgUser, errorResponse } = await guardOrgAdmin(env, request);
  if (errorResponse) return errorResponse;

  const body = await request.json() as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : null;
  if (!name) return apiError("Name is required", 400);

  const db = getDb(env);
  await db.update(organizations).set({ name, updatedAt: new Date() }).where(eq(organizations.id, orgUser.organizationId));
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgUser.organizationId)).limit(1);

  return apiSuccess({ organization: org });
}
