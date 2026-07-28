import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  organizations,
  organizationMembers,
  users,
  domains,
  mailboxes,
  apiKeys,
  contacts,
  messages,
  outboundJobs,
  routingRules,
  webhooks,
  sessions,
} from "@/db/schema";

export async function backfillOrganizations(env: CloudflareEnv): Promise<{ orgsCreated: number }> {
  const db = getDb(env);
  const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
  let orgsCreated = 0;

  for (const user of allUsers) {
    const orgId = `org_${user.id}`;
    const memberId = `om_${user.id}`;

    const [existing] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (existing) continue;

    await db.insert(organizations).values({
      id: orgId,
      name: `${user.name}'s Workspace`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(organizationMembers).values({
      id: memberId,
      organizationId: orgId,
      userId: user.id,
      role: "owner",
      createdAt: new Date(),
    });

    await db.update(users).set({ organizationId: orgId }).where(eq(users.id, user.id));
    await db.update(domains).set({ organizationId: orgId }).where(eq(domains.userId, user.id));
    await db.update(mailboxes).set({ organizationId: orgId }).where(eq(mailboxes.userId, user.id));
    await db.update(apiKeys).set({ organizationId: orgId }).where(eq(apiKeys.userId, user.id));
    await db.update(contacts).set({ organizationId: orgId }).where(eq(contacts.userId, user.id));
    await db.update(messages).set({ organizationId: orgId }).where(eq(messages.userId, user.id));
    await db.update(outboundJobs).set({ organizationId: orgId }).where(eq(outboundJobs.userId, user.id));
    await db.update(routingRules).set({ organizationId: orgId }).where(eq(routingRules.userId, user.id));
    await db.update(webhooks).set({ organizationId: orgId }).where(eq(webhooks.userId, user.id));
    await db.update(sessions).set({ organizationId: orgId }).where(eq(sessions.userId, user.id));

    orgsCreated++;
  }

  return { orgsCreated };
}

export async function ensureUserOrg(env: CloudflareEnv, userId: string): Promise<string> {
  const db = getDb(env);
  const [user] = await db.select({ id: users.id, name: users.name, organizationId: users.organizationId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");

  if (user.organizationId) return user.organizationId;

  const orgId = `org_${userId}`;
  await db.insert(organizations).values({
    id: orgId,
    name: `${user.name}'s Workspace`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(organizationMembers).values({
    id: `om_${userId}`,
    organizationId: orgId,
    userId,
    role: "owner",
    createdAt: new Date(),
  });

  await db.update(users).set({ organizationId: orgId }).where(eq(users.id, userId));
  return orgId;
}
