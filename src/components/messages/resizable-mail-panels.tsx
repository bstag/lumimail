"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	clampConversationPanelHeight,
	clampConversationPanelWidth,
	MAX_CONVERSATION_PANEL_HEIGHT,
	MAX_CONVERSATION_PANEL_WIDTH,
	MIN_CONVERSATION_PANEL_HEIGHT,
	MIN_CONVERSATION_PANEL_WIDTH,
	type SplitOrientation,
} from "./desktop-split-utils";

const PANEL_WIDTH_KEY = "lumimail:conversation-panel-width";
const PANEL_HEIGHT_KEY = "lumimail:conversation-panel-height";

/**
 * The two orientations resize on different axes but share every other rule, so
 * the axis-specific pieces are collected here once instead of branching through
 * the component.
 */
const axis = {
	right: {
		storageKey: PANEL_WIDTH_KEY,
		minimum: MIN_CONVERSATION_PANEL_WIDTH,
		absoluteMaximum: MAX_CONVERSATION_PANEL_WIDTH,
		defaultSize: 560,
		clamp: clampConversationPanelWidth,
		available: (container: HTMLElement | null) =>
			container?.clientWidth
				?? (typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 1440),
		pointerPosition: (event: { clientX: number; clientY: number }) => event.clientX,
		// The panel sits at the trailing edge, so dragging toward the start grows it.
		growKey: "ArrowLeft",
		shrinkKey: "ArrowRight",
		separatorOrientation: "vertical" as const,
	},
	bottom: {
		storageKey: PANEL_HEIGHT_KEY,
		minimum: MIN_CONVERSATION_PANEL_HEIGHT,
		absoluteMaximum: MAX_CONVERSATION_PANEL_HEIGHT,
		defaultSize: 420,
		clamp: clampConversationPanelHeight,
		available: (container: HTMLElement | null) =>
			container?.clientHeight
				?? (typeof globalThis.innerHeight === "number" ? globalThis.innerHeight : 900),
		pointerPosition: (event: { clientX: number; clientY: number }) => event.clientY,
		growKey: "ArrowUp",
		shrinkKey: "ArrowDown",
		separatorOrientation: "horizontal" as const,
	},
};

export function ResizableMailPanels({
	list,
	detail,
	orientation = "right",
}: {
	list: React.ReactNode;
	detail: React.ReactNode;
	orientation?: SplitOrientation;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const config = axis[orientation];
	const [panelSize, setPanelSize] = useState(config.defaultSize);
	const [maximum, setMaximum] = useState(config.absoluteMaximum);

	const availableSpace = useCallback(
		() => axis[orientation].available(containerRef.current),
		[orientation],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const { storageKey, clamp } = axis[orientation];
		function syncSize() {
			const space = availableSpace();
			setMaximum(clamp(Number.POSITIVE_INFINITY, space));
			setPanelSize((current) => clamp(globalThis.localStorage.getItem(storageKey) ?? current, space));
		}
		syncSize();
		globalThis.addEventListener("resize", syncSize);
		return () => globalThis.removeEventListener("resize", syncSize);
	}, [availableSpace, orientation]);

	function commitSize(next: number) {
		const size = config.clamp(next, availableSpace());
		setPanelSize(size);
		globalThis.localStorage.setItem(config.storageKey, String(size));
	}

	function startResize(event: React.PointerEvent<HTMLDivElement>) {
		event.preventDefault();
		const start = config.pointerPosition(event);
		const startSize = panelSize;
		function move(moveEvent: PointerEvent) {
			setPanelSize(config.clamp(startSize + start - config.pointerPosition(moveEvent), availableSpace()));
		}
		function finish(finishEvent: PointerEvent) {
			commitSize(startSize + start - config.pointerPosition(finishEvent));
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", finish);
		}
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", finish, { once: true });
	}

	function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key === config.growKey) commitSize(panelSize + 24);
		else if (event.key === config.shrinkKey) commitSize(panelSize - 24);
		else if (event.key === "Home") commitSize(config.minimum);
		else if (event.key === "End") commitSize(maximum);
		else return;
		event.preventDefault();
	}

	const right = orientation === "right";
	return (
		<div
			ref={containerRef}
			className="grid h-full min-h-0 min-w-0"
			style={
				right
					? { gridTemplateColumns: `minmax(360px, 1fr) 1px ${panelSize}px` }
					: { gridTemplateRows: `minmax(240px, 1fr) 1px ${panelSize}px` }
			}
			data-testid="desktop-mail-split"
			data-orientation={orientation}
		>
			<div className="min-h-0 min-w-0 overflow-hidden">{list}</div>
			<div
				role="separator"
				aria-label="Resize conversation panel"
				aria-orientation={config.separatorOrientation}
				aria-valuemin={config.minimum}
				aria-valuemax={maximum}
				aria-valuenow={panelSize}
				tabIndex={0}
				onPointerDown={startResize}
				onKeyDown={resizeWithKeyboard}
				className={
					right
						? "relative z-10 cursor-col-resize bg-border outline-none after:absolute after:inset-y-0 after:-left-1 after:w-3 focus:bg-accent"
						: "relative z-10 cursor-row-resize bg-border outline-none after:absolute after:inset-x-0 after:-top-1 after:h-3 focus:bg-accent"
				}
			/>
			<section
				aria-label="Open conversation"
				className={
					right
						? "min-w-0 overflow-hidden border-l border-border bg-surface-raised"
						: "min-h-0 overflow-hidden border-t border-border bg-surface-raised"
				}
			>
				{detail}
			</section>
		</div>
	);
}
