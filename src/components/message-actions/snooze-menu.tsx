"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { isSnoozed, snoozeUntil, type SnoozePreset } from "./snooze-utils";
import { snoozeMessage } from "./utils";

/** Snooze presets for a received message, plus Unsnooze while it sleeps (F100). */
export function SnoozeMenu({ messageId, snoozedUntil, disabled, onError }: {
	messageId: string;
	snoozedUntil?: string | null;
	disabled: boolean;
	onError: () => void;
}) {
	const t = useTranslations("actions");
	const router = useRouter();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(false);

	async function run(choice: SnoozePreset | "wake") {
		setPending(true);
		try {
			await snoozeMessage(queryClient, messageId, choice === "wake" ? null : snoozeUntil(choice, new Date()));
			router.push(choice === "wake" ? "/inbox" : "/snoozed");
			router.refresh();
		} catch {
			onError();
		} finally {
			setPending(false);
		}
	}

	return <Tooltip label={t("snooze")}>
		<Select
			size="sm" className="w-auto"
			disabled={disabled || pending}
			defaultValue=""
			aria-label={t("snooze")}
			onChange={(event) => {
				const choice = event.target.value as SnoozePreset | "wake" | "";
				event.target.value = "";
				if (choice) void run(choice);
			}}
		>
			<option value="">{t("snooze")}</option>
			<option value="later_today">{t("snoozeLaterToday")}</option>
			<option value="tomorrow">{t("snoozeTomorrow")}</option>
			<option value="next_week">{t("snoozeNextWeek")}</option>
			{isSnoozed(snoozedUntil, new Date()) && <option value="wake">{t("unsnooze")}</option>}
		</Select>
	</Tooltip>;
}
