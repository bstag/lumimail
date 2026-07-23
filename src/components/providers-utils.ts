import type { QueryClient } from "@tanstack/react-query";
import { registerAccountStateReset } from "@/lib/auth/account-state";

type ClearableQueryClient = Pick<QueryClient, "clear">;

export function registerQueryClientAccountReset(client: ClearableQueryClient): () => void {
	return registerAccountStateReset(() => {
		client.clear();
	});
}
