import { describe, expect, it, vi } from "vitest";

import { registerQueryClientAccountReset } from "@/components/providers-utils";
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
