"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	clampConversationPanelWidth,
	MAX_CONVERSATION_PANEL_WIDTH,
	MIN_CONVERSATION_PANEL_WIDTH,
} from "./desktop-split-utils";

const PANEL_WIDTH_KEY = "lumimail:conversation-panel-width";

export function ResizableMailPanels({
	list,
	detail,
}: {
	list: React.ReactNode;
	detail: React.ReactNode;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [panelWidth, setPanelWidth] = useState(560);
	const [maximum, setMaximum] = useState(MAX_CONVERSATION_PANEL_WIDTH);

	const availableWidth = useCallback(() => {
		return containerRef.current?.clientWidth
			?? (typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 1440);
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		function syncWidth() {
			const width = availableWidth();
			setMaximum(clampConversationPanelWidth(Number.POSITIVE_INFINITY, width));
			setPanelWidth((current) => clampConversationPanelWidth(
				globalThis.localStorage.getItem(PANEL_WIDTH_KEY) ?? current,
				width,
			));
		}
		syncWidth();
		globalThis.addEventListener("resize", syncWidth);
		return () => globalThis.removeEventListener("resize", syncWidth);
	}, [availableWidth]);

	function commitWidth(next: number) {
		const width = clampConversationPanelWidth(next, availableWidth());
		setPanelWidth(width);
		globalThis.localStorage.setItem(PANEL_WIDTH_KEY, String(width));
	}

	function startResize(event: React.PointerEvent<HTMLDivElement>) {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = panelWidth;
		function move(moveEvent: PointerEvent) {
			setPanelWidth(clampConversationPanelWidth(
				startWidth + startX - moveEvent.clientX,
				availableWidth(),
			));
		}
		function finish(finishEvent: PointerEvent) {
			commitWidth(startWidth + startX - finishEvent.clientX);
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", finish);
		}
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", finish, { once: true });
	}

	function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key === "ArrowLeft") commitWidth(panelWidth + 24);
		else if (event.key === "ArrowRight") commitWidth(panelWidth - 24);
		else if (event.key === "Home") commitWidth(MIN_CONVERSATION_PANEL_WIDTH);
		else if (event.key === "End") commitWidth(maximum);
		else return;
		event.preventDefault();
	}

	return (
		<div
			ref={containerRef}
			className="grid h-full min-h-0 min-w-0"
			style={{ gridTemplateColumns: `minmax(360px, 1fr) 1px ${panelWidth}px` }}
			data-testid="desktop-mail-split"
		>
			<div className="min-w-0 overflow-hidden">{list}</div>
			<div
				role="separator"
				aria-label="Resize conversation panel"
				aria-orientation="vertical"
				aria-valuemin={MIN_CONVERSATION_PANEL_WIDTH}
				aria-valuemax={maximum}
				aria-valuenow={panelWidth}
				tabIndex={0}
				onPointerDown={startResize}
				onKeyDown={resizeWithKeyboard}
				className="relative z-10 cursor-col-resize bg-border outline-none after:absolute after:inset-y-0 after:-left-1 after:w-3 focus:bg-accent"
			/>
			<section aria-label="Open conversation" className="min-w-0 overflow-hidden border-l border-border bg-surface-raised">
				{detail}
			</section>
		</div>
	);
}
