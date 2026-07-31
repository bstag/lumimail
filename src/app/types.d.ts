import type { LucideIcon } from "lucide-react";
import type { ButtonProps } from "@/components/ui/button";

export type HomeAction = {
	href: string;
	/** Key in the `landing` namespace; the page resolves it with `t()`. */
	labelKey: "logIn" | "createAccount" | "dashboard";
	variant: ButtonProps["variant"];
};

export type SidebarItem = {
	/** Key in the `nav` namespace; the page resolves it with `t()`. */
	labelKey: string;
	icon: LucideIcon;
	active?: boolean;
	count?: string;
};

export type MailPreview = {
	icon: LucideIcon;
	sender: string;
	subject: string;
	preview: string;
	badge: string;
};
