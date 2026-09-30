import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { privacyPolicy } from "@/lib/legal/legal-content";

export const metadata: Metadata = {
	title: "Privacy Policy — Picket",
	description: privacyPolicy.summary,
};

export default function PrivacyPage() {
	return <LegalDocumentView document={privacyPolicy} />;
}
