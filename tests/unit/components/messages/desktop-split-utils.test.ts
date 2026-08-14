import { describe, expect, it } from "vitest";
import {
	clampConversationPanelWidth,
	getConversationInitial,
	parseSelectedMessageId,
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

	it("derives a stable avatar initial from a name or address", () => {
		expect(getConversationInitial("Maya Chen")).toBe("M");
		expect(getConversationInitial('"support" <support@example.com>')).toBe("S");
		expect(getConversationInitial(" álvaro@example.com ")).toBe("Á");
		expect(getConversationInitial(" ")).toBe("?");
	});
});
