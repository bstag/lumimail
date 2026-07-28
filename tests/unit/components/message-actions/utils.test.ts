import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { runSingleMessageAction } from "@/components/message-actions/utils";

beforeEach(() => {
	authFetch.mockReset();
	vi.stubGlobal("window", { dispatchEvent: vi.fn() });
});

describe("runSingleMessageAction", () => {
	it("announces a successful message mutation", async () => {
		authFetch.mockResolvedValue({ ok: true });

		await runSingleMessageAction("msg_1", "read");

		expect(window.dispatchEvent).toHaveBeenCalledWith(
			expect.objectContaining({ type: "lumimail:messages-changed" }),
		);
	});

	it("rejects and does not announce a failed message mutation", async () => {
		authFetch.mockResolvedValue({ ok: false });

		await expect(runSingleMessageAction("msg_1", "read")).rejects.toThrow("Unable to update message");

		expect(window.dispatchEvent).not.toHaveBeenCalled();
	});
});
