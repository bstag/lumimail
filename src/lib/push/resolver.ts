import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
	mailboxMemberships,
	messages,
	pushDeliveries,
	pushDevices,
	pushNotificationEvents,
} from "@/db/schema";
import { hasMailboxCapability, type MailboxRole } from "@/lib/auth/mailbox-access";

type ResolveArgs = {
	deliveryId: string;
	userId: string;
	organizationId: string;
};

export async function resolvePushNotification(env: CloudflareEnv, args: ResolveArgs) {
	const [row] = await getDb(env)
		.select({
			messageId: messages.id,
			deviceStatus: pushDevices.status,
			deviceUserId: pushDevices.userId,
			deviceOrganizationId: pushDevices.organizationId,
			messageOrganizationId: messages.organizationId,
			messageMailboxId: messages.mailboxId,
			messageStatus: messages.status,
			membershipUserId: mailboxMemberships.userId,
			membershipMailboxId: mailboxMemberships.mailboxId,
			membershipRole: mailboxMemberships.role,
		})
		.from(pushDeliveries)
		.innerJoin(pushDevices, eq(pushDevices.id, pushDeliveries.deviceId))
		.innerJoin(pushNotificationEvents, eq(pushNotificationEvents.id, pushDeliveries.eventId))
		.innerJoin(messages, eq(messages.id, pushNotificationEvents.messageId))
		.innerJoin(mailboxMemberships, and(
			eq(mailboxMemberships.userId, pushDevices.userId),
			eq(mailboxMemberships.mailboxId, pushNotificationEvents.mailboxId),
		))
		.where(eq(pushDeliveries.id, args.deliveryId))
		.limit(1);
	if (!row
		|| row.deviceStatus !== "active"
		|| row.deviceUserId !== args.userId
		|| row.deviceOrganizationId !== args.organizationId
		|| row.messageOrganizationId !== args.organizationId
		|| row.messageMailboxId !== row.membershipMailboxId
		|| row.messageStatus !== "received"
		|| row.membershipUserId !== args.userId
		|| !hasMailboxCapability(row.membershipRole as MailboxRole, "read")) {
		return null;
	}
	return { messageId: row.messageId };
}
