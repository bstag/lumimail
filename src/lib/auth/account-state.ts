export const SELECTED_MAILBOX_STORAGE_KEY = "selected-mailbox-id";
const ACCOUNT_STATE_RESET_EVENT = "lumimail:account-state-reset";

type AccountStateResetListener = () => void;
type BrowserEventTarget = Pick<Window, "addEventListener" | "removeEventListener" | "dispatchEvent">;

const resetListeners = new Set<AccountStateResetListener>();

function getBrowserEventTarget(): BrowserEventTarget | null {
	if (
		typeof window === "undefined" ||
		typeof window.addEventListener !== "function" ||
		typeof window.removeEventListener !== "function" ||
		typeof window.dispatchEvent !== "function"
	) {
		return null;
	}
	return window;
}

export function registerAccountStateReset(listener: AccountStateResetListener): () => void {
	const eventTarget = getBrowserEventTarget();
	if (eventTarget) {
		const onReset = () => {
			try {
				listener();
			} catch {
				// A failing cache must not interrupt the other browser listeners.
			}
		};
		eventTarget.addEventListener(ACCOUNT_STATE_RESET_EVENT, onReset);
		return () => {
			eventTarget.removeEventListener(ACCOUNT_STATE_RESET_EVENT, onReset);
		};
	}

	resetListeners.add(listener);
	return () => {
		resetListeners.delete(listener);
	};
}

export function resetAccountScopedClientState(): void {
	if (typeof window !== "undefined") {
		try {
			localStorage.removeItem(SELECTED_MAILBOX_STORAGE_KEY);
		} catch {
			// Storage can be unavailable; in-memory resets must still run.
		}
	}

	const eventTarget = getBrowserEventTarget();
	if (eventTarget && typeof Event === "function") {
		eventTarget.dispatchEvent(new Event(ACCOUNT_STATE_RESET_EVENT));
		return;
	}

	for (const listener of [...resetListeners]) {
		try {
			listener();
		} catch {
			// One cache must not prevent the remaining account state from clearing.
		}
	}
}
