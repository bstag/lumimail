import ApiKeysPage from "@/app/(admin)/api-keys/page";
import { SettingsShell } from "@/components/settings/settings-shell";

export default function PersonalApiKeysPage() {
	return (
		<SettingsShell>
			<ApiKeysPage />
		</SettingsShell>
	);
}
