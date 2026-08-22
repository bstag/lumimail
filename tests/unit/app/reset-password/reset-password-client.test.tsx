// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
	params: new Map<string, string>(),
	submitPasswordReset: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => ({ get: (key: string) => mocks.params.get(key) ?? null }),
}));
vi.mock("@/app/reset-password/utils", () => ({
	submitPasswordReset: (...args: unknown[]) => mocks.submitPasswordReset(...args),
}));
vi.mock("@/components/auth/auth-shell", () => ({
	AuthShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { ResetPasswordClient } from "@/app/reset-password/reset-password-client";

let root: Root | undefined;
let container: HTMLDivElement;

async function renderClient() {
	container = document.createElement("div") as HTMLDivElement;
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => root?.render(<ResetPasswordClient />));
}

async function submit(newPassword: string, confirmation: string) {
	const inputs = container.querySelectorAll<HTMLInputElement>("input");
	inputs[0].value = newPassword;
	inputs[1].value = confirmation;
	await act(async () => {
		container.querySelector("form")?.dispatchEvent(new Event("submit", {
			bubbles: true,
			cancelable: true,
		}));
	});
}

beforeEach(() => {
	mocks.params.clear();
	mocks.submitPasswordReset.mockReset();
});

afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	root = undefined;
});

describe("ResetPasswordClient", () => {
	it("renders an invalid-link state without a complete token pair", async () => {
		await renderClient();
		expect(container.textContent).toContain("incomplete or invalid");
		expect(container.querySelector("form")).toBeNull();
	});

	it("validates matching passwords and completes a successful reset", async () => {
		mocks.params.set("email", "user@example.com");
		mocks.params.set("token", "token_1");
		mocks.submitPasswordReset.mockResolvedValue(undefined);
		await renderClient();

		await submit("long-password", "different-password");
		expect(container.textContent).toContain("Passwords do not match");
		expect(mocks.submitPasswordReset).not.toHaveBeenCalled();

		await submit("long-password", "long-password");
		expect(mocks.submitPasswordReset).toHaveBeenCalledWith({
			email: "user@example.com",
			token: "token_1",
			newPassword: "long-password",
		});
		expect(container.textContent).toContain("Password reset complete");
	});

	it.each([
		[new Error("expired"), "expired"],
		["bad response", "Unable to reset password"],
	])("shows a reset failure", async (cause, message) => {
		mocks.params.set("email", "user@example.com");
		mocks.params.set("token", "token_1");
		mocks.submitPasswordReset.mockRejectedValue(cause);
		await renderClient();
		await submit("long-password", "long-password");
		expect(container.textContent).toContain(message);
	});
});
