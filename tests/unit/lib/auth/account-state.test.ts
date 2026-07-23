import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	registerAccountStateReset,
	resetAccountScopedClientState,
	SELECTED_MAILBOX_STORAGE_KEY,
} from "@/lib/auth/account-state";

let removeItem: ReturnType<typeof vi.fn>;

beforeEach(() => {
	removeItem = vi.fn();
	vi.stubGlobal("localStorage", { removeItem });
	vi.stubGlobal("window", {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("resetAccountScopedClientState", () => {
	it("removes the selected mailbox and notifies registered reset listeners", () => {
		const listener = vi.fn();
		const unsubscribe = registerAccountStateReset(listener);

		resetAccountScopedClientState();

		expect(removeItem).toHaveBeenCalledWith(SELECTED_MAILBOX_STORAGE_KEY);
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it("does not notify a listener after it is unsubscribed", () => {
		const listener = vi.fn();
		const unsubscribe = registerAccountStateReset(listener);
		unsubscribe();

		resetAccountScopedClientState();

		expect(listener).not.toHaveBeenCalled();
	});

	it("continues resetting listeners when storage and another listener throw", () => {
		removeItem.mockImplementation(() => {
			throw new Error("storage denied");
		});
		const failing = registerAccountStateReset(() => {
			throw new Error("listener failed");
		});
		const laterListener = vi.fn();
		const later = registerAccountStateReset(laterListener);

		expect(() => resetAccountScopedClientState()).not.toThrow();
		expect(laterListener).toHaveBeenCalledTimes(1);
		failing();
		later();
	});

	it("still notifies listeners when window is unavailable", () => {
		vi.stubGlobal("window", undefined);
		const listener = vi.fn();
		const unsubscribe = registerAccountStateReset(listener);

		resetAccountScopedClientState();

		expect(removeItem).not.toHaveBeenCalled();
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it("broadcasts resets through the browser event target across module consumers", () => {
		const eventTarget = new EventTarget();
		vi.stubGlobal("window", eventTarget);
		const listener = vi.fn();
		const unsubscribe = registerAccountStateReset(listener);

		resetAccountScopedClientState();
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		resetAccountScopedClientState();
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("isolates a failing browser event listener", () => {
		const eventTarget = new EventTarget();
		vi.stubGlobal("window", eventTarget);
		const failing = registerAccountStateReset(() => {
			throw new Error("listener failed");
		});
		const laterListener = vi.fn();
		const later = registerAccountStateReset(laterListener);

		expect(() => resetAccountScopedClientState()).not.toThrow();
		expect(laterListener).toHaveBeenCalledTimes(1);
		failing();
		later();
	});
});
