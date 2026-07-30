import type { QueryClient } from "@tanstack/react-query";
import { registerAccountStateReset } from "@/lib/auth/account-state";

type ClearableQueryClient = Pick<QueryClient, "clear">;

export function registerQueryClientAccountReset(client: ClearableQueryClient): () => void {
	return registerAccountStateReset(() => {
		client.clear();
	});
}

type ToastableMutation = {
	options: { onError?: unknown };
	meta?: Record<string, unknown>;
};

/**
 * Whether the global MutationCache error handler should surface a mutation
 * failure as a toast. Mutations that handle their own errors (an `onError`
 * callback) or that render errors inline (`meta.suppressErrorToast`) are
 * skipped so the same message is not surfaced twice.
 */
export function shouldToastMutationError(mutation: ToastableMutation): boolean {
	if (mutation.options.onError) return false;
	return mutation.meta?.suppressErrorToast !== true;
}

/** Human-readable toast text for an unknown thrown value. */
export function toMutationErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) return error.message;
	return "Something went wrong. Please try again.";
}
