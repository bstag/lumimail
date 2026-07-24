"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";

const ORDER: Theme[] = ["system", "light", "dark"];

function applyTheme(theme: Theme) {
	const root = document.documentElement;
	if (theme === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", theme);
}

export function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>("system");

	useEffect(() => {
		const stored = localStorage.getItem("theme");
		if (stored === "light" || stored === "dark") setTheme(stored);
	}, []);

	function cycle() {
		const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
		setTheme(next);
		if (next === "system") localStorage.removeItem("theme");
		else localStorage.setItem("theme", next);
		applyTheme(next);
	}

	const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
	const label =
		theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";

	return (
		<div className="fixed bottom-4 left-4 z-30">
			<button
				type="button"
				onClick={cycle}
				aria-label={`Theme: ${label}. Click to switch.`}
				title={`Theme: ${label} — click to switch`}
				className="flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-ink-muted shadow-sm transition-colors hover:border-border-strong hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/20"
			>
				<Icon className="h-4 w-4" />
				<span>{label}</span>
			</button>
		</div>
	);
}
