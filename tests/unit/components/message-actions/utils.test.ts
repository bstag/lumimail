import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { runSingleMessageAction } from "@/components/message-actions/utils";
import { messageKeys } from "@/lib/query-keys";

function mockQueryClient() {
	return { invalidateQueries: vi.fn().mockResolvedValue(undefined) } as unknown as QueryClient;
}

beforeEach(() => {
	authFetch.mockReset();
});

describe("runSingleMessageAction", () => {
	it("invalidates every message query after a successful mutation", async () => {
		authFetch.mockResolvedValue({ ok: true });
		const queryClient = mockQueryClient();

		await runSingleMessageAction(queryClient, "msg_1", "read");

		expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: messageKeys.all });
	});

	it("rejects and does not invalidate after a failed mutation", async () => {
		authFetch.mockResolvedValue({ ok: false });
		const queryClient = mockQueryClient();

		await expect(runSingleMessageAction(queryClient, "msg_1", "read")).rejects.toThrow(
			"Unable to update message",
		);

		expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
	});
});
