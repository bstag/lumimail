import { describe, expect, it, vi } from "vitest";

import {
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
