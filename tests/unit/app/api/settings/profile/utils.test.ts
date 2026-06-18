import { describe, expect, it } from "vitest";
import { parseUpdateProfileRequest } from "@/app/api/settings/profile/utils";

const requestWith = (body: unknown) =>
	new Request("https://example.com/api/settings/profile", {
		method: "PUT",
		body: JSON.stringify(body),
	});

describe("parseUpdateProfileRequest", () => {
	it("parses and normalizes a valid body", async () => {
		const result = await parseUpdateProfileRequest(
			requestWith({ name: "  Ada  ", resetEmail: "  ada@example.com  " }),
		);
		expect(result).toEqual({ name: "Ada", resetEmail: "ada@example.com" });
	});

	it("coerces an empty resetEmail to null", async () => {
		const result = await parseUpdateProfileRequest(
			requestWith({ name: "Ada", resetEmail: "" }),
		);
		expect(result).toEqual({ name: "Ada", resetEmail: null });
	});

	it("rejects an invalid body", async () => {
		await expect(
			parseUpdateProfileRequest(requestWith({ name: "", resetEmail: "" })),
		).rejects.toThrow();
	});
});
