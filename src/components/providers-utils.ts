import { focusManager, type QueryClient } from "@tanstack/react-query";
import { registerAccountStateReset } from "@/lib/auth/account-state";

type FocusEventTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * TanStack v5 only watches `visibilitychange`, but the mail UI's old refresh
 * listeners also fired on plain window `focus` (e.g. clicking back into the
 * browser from another window without a visibility change). Registering both
 * events keeps that behavior for `refetchOnWindowFocus` queries.
 */
export function configureQueryFocusEvents(
	manager: Pick<typeof focusManager, "setEventListener"> = focusManager,
	eventTarget: FocusEventTarget | null = typeof window === "undefined" ? null : window,
): void {
	if (!eventTarget) return;
	manager.setEventListener((onFocus) => {
		const listener = () => onFocus();
		eventTarget.addEventListener("visibilitychange", listener, false);
		eventTarget.addEventListener("focus", listener, false);
		return () => {
			eventTarget.removeEventListener("visibilitychange", listener);
			eventTarget.removeEventListener("focus", listener);
		};
	});
}

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
