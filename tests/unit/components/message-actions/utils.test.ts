import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { runSingleMessageAction, snoozeMessage } from "@/components/message-actions/utils";
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

describe("snoozeMessage (F100)", () => {
	it("posts the wake time, or null to wake, and refreshes message queries", async () => {
		authFetch.mockResolvedValue({ ok: true });
		const queryClient = mockQueryClient();

		await snoozeMessage(queryClient, "msg 1", new Date("2026-11-08T08:00:00Z"));
		await snoozeMessage(queryClient, "msg 1", null);

		expect(authFetch.mock.calls.map(([url, init]) => [url, JSON.parse((init as RequestInit).body as string)])).toEqual([
			["/api/messages/msg%201/snooze", { until: "2026-11-08T08:00:00.000Z" }],
			["/api/messages/msg%201/snooze", { until: null }],
		]);
		expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
	});

	it("rejects without refreshing when the server refuses", async () => {
		authFetch.mockResolvedValue({ ok: false });
		const queryClient = mockQueryClient();
		await expect(snoozeMessage(queryClient, "msg_1", null)).rejects.toThrow("Unable to snooze message");
		expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
	});
});

