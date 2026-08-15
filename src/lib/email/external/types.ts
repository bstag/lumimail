export type ExternalProvider = "google" | "microsoft";
export type ExternalImportMode = "from_now" | "recent_30_days";

export type ExternalSyncQueueMessage = {
	kind: "external-sync";
	version: 1;
	jobId: string;
};
