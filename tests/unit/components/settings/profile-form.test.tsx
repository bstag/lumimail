// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiResponseError } from "@/lib/api/client-response";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const patchProfile = vi.fn();
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/api/client-response", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/api/client-response")>();
	return { ...actual, apiJson: { patch: (...args: unknown[]) => patchProfile(...args) } };
});

import { ProfileForm, saveProfile } from "@/components/settings/profile-form";

let root: Root | undefined;
let container: HTMLDivElement;

async function renderForm() {
	container = document.createElement("div") as HTMLDivElement;
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => root?.render(
		<ProfileForm initialName="Old" initialResetEmail="old@example.com" email="login@example.com" />,
	));
}

function change(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit() {
	await act(async () => {
		container.querySelector("form")?.dispatchEvent(new Event("submit", {
			bubbles: true,
			cancelable: true,
		}));
	});
}

beforeEach(() => patchProfile.mockReset());
afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	root = undefined;
});

describe("ProfileForm", () => {
	it("saves normalized profile values", async () => {
		patchProfile.mockResolvedValue({ user: { name: "Updated", resetEmail: "new@example.com" } });
		await renderForm();
		const [name, resetEmail] = container.querySelectorAll<HTMLInputElement>("input");
		await act(async () => {
			change(name, " Updated ");
			change(resetEmail, "new@example.com");
		});
		await submit();

		expect(patchProfile).toHaveBeenCalledWith("/api/settings/profile", {
			name: " Updated ", resetEmail: "new@example.com",
		});
		expect(name.value).toBe("Updated");
		expect(container.textContent).toContain("saved");
	});

	it("uses local fallbacks when the response omits user fields", async () => {
		patchProfile.mockResolvedValue({});
		await renderForm();
		const [name, resetEmail] = container.querySelectorAll<HTMLInputElement>("input");
		await act(async () => {
			change(name, " Trimmed ");
			change(resetEmail, "");
		});
		await submit();
		expect(name.value).toBe("Trimmed");
		expect(resetEmail.value).toBe("");
	});

	it.each([
		["api", "denied"],
		["generic", "accountFailed"],
	])("shows save failures", async (kind, message) => {
		const error = kind === "api"
			? new ApiResponseError("denied", 403)
			: new Error("network");
		const rejectRequest = vi.fn(async () => { throw error; });
		await expect(saveProfile("Changed", "", "accountFailed", rejectRequest)).resolves.toEqual({
			ok: false,
			message,
		});
	});
});
