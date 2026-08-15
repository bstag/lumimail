import { describe, expect, it } from "vitest";
import {
	clampConversationPanelHeight,
	clampConversationPanelWidth,
	getConversationInitial,
	parseSelectedMessageId,
	parseSplitOrientation,
} from "@/components/messages/desktop-split-utils";

describe("desktop split view utilities", () => {
	it("accepts one bounded Lumimail message id", () => {
		expect(parseSelectedMessageId(new URLSearchParams("message=msg_abc-123"))).toBe("msg_abc-123");
		expect(parseSelectedMessageId(new URLSearchParams("message=msg_one&message=msg_two"))).toBeNull();
		expect(parseSelectedMessageId(new URLSearchParams("message=outside"))).toBeNull();
		expect(parseSelectedMessageId(new URLSearchParams())).toBeNull();
	});

	it("clamps stored panel widths while preserving room for the list", () => {
		expect(clampConversationPanelWidth(null, 1440)).toBe(560);
		expect(clampConversationPanelWidth(612.4, 1440)).toBe(612);
		expect(clampConversationPanelWidth("720", 1440)).toBe(720);
		expect(clampConversationPanelWidth("100", 1440)).toBe(360);
		expect(clampConversationPanelWidth("1200", 1440)).toBe(900);
		expect(clampConversationPanelWidth("900", 1024)).toBe(664);
		expect(clampConversationPanelWidth("900", 600)).toBe(360);
		expect(clampConversationPanelWidth("not-a-number", 1024)).toBe(560);
	});

	it("clamps stored panel heights while preserving room for the list", () => {
		expect(clampConversationPanelHeight(null, 900)).toBe(420);
		expect(clampConversationPanelHeight(455.6, 900)).toBe(456);
		expect(clampConversationPanelHeight("500", 900)).toBe(500);
		expect(clampConversationPanelHeight("100", 900)).toBe(240);
		expect(clampConversationPanelHeight("900", 900)).toBe(660);
		expect(clampConversationPanelHeight("900", 2000)).toBe(720);
		expect(clampConversationPanelHeight("600", 400)).toBe(240);
		expect(clampConversationPanelHeight("not-a-number", 900)).toBe(420);
	});

	it("fails closed to the right-hand orientation", () => {
		expect(parseSplitOrientation("bottom")).toBe("bottom");
		expect(parseSplitOrientation("right")).toBe("right");
		expect(parseSplitOrientation("sideways")).toBe("right");
		expect(parseSplitOrientation(null)).toBe("right");
	});

	it("derives a stable avatar initial from a name or address", () => {
		expect(getConversationInitial("Maya Chen")).toBe("M");
		expect(getConversationInitial('"support" <support@example.com>')).toBe("S");
		expect(getConversationInitial(" álvaro@example.com ")).toBe("Á");
		expect(getConversationInitial(" ")).toBe("?");
	});
});
