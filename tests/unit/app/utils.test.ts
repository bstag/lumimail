import { describe, expect, it } from "vitest";
import { getHomeActions, heroMessages, sidebarItems } from "@/app/utils";

describe("getHomeActions", () => {
	it("returns a single dashboard action when logged in", () => {
		const actions = getHomeActions(true);
		expect(actions).toEqual([{ href: "/inbox", labelKey: "dashboard", variant: "default" }]);
	});

	it("returns login and register actions when logged out", () => {
		const actions = getHomeActions(false);
		expect(actions.map((a) => a.href)).toEqual(["/login", "/register"]);
		expect(actions.at(-1)?.variant).toBe("default");
	});
});

describe("landing content tables", () => {
	it("marks exactly one sidebar item active", () => {
		expect(sidebarItems.filter((item) => item.active)).toHaveLength(1);
	});

	it("exposes non-empty hero messages", () => {
		expect(heroMessages.length).toBeGreaterThan(0);
	});

	it("gives every hero message a sender, subject and badge", () => {
		for (const message of heroMessages) {
			expect(message.sender).toMatch(/@/);
			expect(message.subject.length).toBeGreaterThan(0);
			expect(message.badge.length).toBeGreaterThan(0);
		}
	});
});
