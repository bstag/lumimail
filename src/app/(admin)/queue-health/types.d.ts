import type { QueueHealthSnapshot } from "@/lib/queue-health";

export type QueueHealthResponse = {
	queues: QueueHealthSnapshot[];
};
