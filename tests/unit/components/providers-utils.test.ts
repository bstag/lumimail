import { describe, expect, it, vi } from "vitest";

import {
	configureQueryFocusEvents,
	registerQueryClientAccountReset,
	shouldToastMutationError,
	toMutationErrorMessage,
} from "@/components/providers-utils";
import { resetAccountScopedClientState } from "@/lib/auth/account-state";

describe("registerQueryClientAccountReset", () => {
	it("clears query data on reset and stops after unsubscribe", () => {
		const client = { clear: vi.fn() };
		const unsubscribe = registerQueryClientAccountReset(client);

		resetAccountScopedClientState();
		expect(client.clear).toHaveBeenCalledTimes(1);

		unsubscribe();
		resetAccountScopedClientState();
		expect(client.clear).toHaveBeenCalledTimes(1);
	});
});

describe("configureQueryFocusEvents", () => {
	function fakeEventTarget() {
		const listeners = new Map<string, () => void>();
		return {
			listeners,
			addEventListener: vi.fn((type: string, listener: () => void) => {
				listeners.set(type, listener);
			}),
			removeEventListener: vi.fn((type: string) => {
				listeners.delete(type);
			}),
		};
	}

	it("signals focus for both visibilitychange and plain window focus", () => {
		const eventTarget = fakeEventTarget();
		const onFocus = vi.fn();
		const manager = {
			setEventListener: vi.fn(
				(setup: (setFocused: () => void) => (() => void) | undefined) => {
					setup(onFocus);
				},
			),
		};

		configureQueryFocusEvents(manager, eventTarget as never);

		expect(eventTarget.addEventListener).toHaveBeenCalledWith(
			"visibilitychange",
			expect.any(Function),
			false,
		);
		expect(eventTarget.addEventListener).toHaveBeenCalledWith(
			"focus",
			expect.any(Function),
			false,
		);
		eventTarget.listeners.get("focus")?.();
		eventTarget.listeners.get("visibilitychange")?.();
		expect(onFocus).toHaveBeenCalledTimes(2);
	});

	it("removes both listeners when the manager tears the setup down", () => {
		const eventTarget = fakeEventTarget();
		let cleanup: (() => void) | undefined;
		const manager = {
			setEventListener: vi.fn(
				(setup: (setFocused: () => void) => (() => void) | undefined) => {
					cleanup = setup(vi.fn()) ?? undefined;
				},
			),
		};

		configureQueryFocusEvents(manager, eventTarget as never);
		cleanup?.();

		expect(eventTarget.removeEventListener).toHaveBeenCalledWith(
			"visibilitychange",
			expect.any(Function),
		);
		expect(eventTarget.removeEventListener).toHaveBeenCalledWith("focus", expect.any(Function));
	});

	it("does nothing without a browser event target", () => {
		const manager = { setEventListener: vi.fn() };
		// Explicit null and the node default (no window) both bail out; the
		// zero-argument call also exercises the real focusManager default.
		configureQueryFocusEvents(manager, null);
		configureQueryFocusEvents(manager);
		expect(manager.setEventListener).not.toHaveBeenCalled();
		expect(() => configureQueryFocusEvents()).not.toThrow();
	});

	it("defaults to the browser window when one exists", () => {
		const addEventListener = vi.fn();
		const removeEventListener = vi.fn();
		vi.stubGlobal("window", { addEventListener, removeEventListener });
		const manager = {
			setEventListener: vi.fn(
				(setup: (setFocused: () => void) => (() => void) | undefined) => {
					setup(vi.fn());
				},
			),
		};

		configureQueryFocusEvents(manager);

		expect(addEventListener).toHaveBeenCalledWith("focus", expect.any(Function), false);
		vi.unstubAllGlobals();
	});
});

describe("shouldToastMutationError", () => {
	it("toasts mutations that have no error handling of their own", () => {
		expect(shouldToastMutationError({ options: {} })).toBe(true);
		expect(shouldToastMutationError({ options: {}, meta: {} })).toBe(true);
	});

	it("skips mutations with their own onError callback", () => {
		expect(shouldToastMutationError({ options: { onError: vi.fn() } })).toBe(false);
	});

	it("skips mutations that render errors inline via meta.suppressErrorToast", () => {
		expect(shouldToastMutationError({ options: {}, meta: { suppressErrorToast: true } })).toBe(false);
		expect(shouldToastMutationError({ options: {}, meta: { suppressErrorToast: false } })).toBe(true);
	});
});

describe("toMutationErrorMessage", () => {
	it("uses the error message when present", () => {
		expect(toMutationErrorMessage(new Error("Mailbox not found"))).toBe("Mailbox not found");
	});

	it("falls back for empty or non-Error values", () => {
		expect(toMutationErrorMessage(new Error("   "))).toBe("Something went wrong. Please try again.");
		expect(toMutationErrorMessage("boom")).toBe("Something went wrong. Please try again.");
		expect(toMutationErrorMessage(undefined)).toBe("Something went wrong. Please try again.");
	});
});
