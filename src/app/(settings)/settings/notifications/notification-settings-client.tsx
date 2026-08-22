"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Laptop, Pencil, ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiJson } from "@/lib/api/client-response";

type PushConfig = { available: boolean; vapidPublicKey: string | null };
type Device = {
	id: string;
	name: string;
	status: "active" | "revoked" | "expired";
	current: boolean;
	mailboxIds: string[];
	createdAt: string;
	lastDeliveredAt: string | null;
};
type Mailbox = {
	id: string;
	localPart: string;
	hostname: string;
	displayName: string | null;
};
type BrowserSupport = "checking" | "supported" | "unsupported" | "install-required" | "denied";

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pushApisAvailable() {
	return globalThis.isSecureContext
		&& "serviceWorker" in navigator
		&& "PushManager" in globalThis
		&& "Notification" in globalThis;
}

function detectBrowserSupport(): BrowserSupport {
	if (!pushApisAvailable()) return "unsupported";
	const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
	if (isIos && !globalThis.matchMedia("(display-mode: standalone)").matches) return "install-required";
	if (Notification.permission === "denied") return "denied";
	return "supported";
}

async function requestNotificationPermission() {
	const permission = await Notification.requestPermission();
	if (permission !== "granted") throw new Error(permission === "denied" ? "denied" : "not-granted");
}

function requireSubscriptionJson(json: PushSubscriptionJSON) {
	if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("Browser returned an invalid push subscription");
	return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

async function enableNotifications(config: PushConfig | undefined, deviceName: string) {
	if (!config?.available || !config.vapidPublicKey) throw new Error("Push notifications are unavailable");
	await requestNotificationPermission();
	const registration = await navigator.serviceWorker.ready;
	const browserSubscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: decodeApplicationServerKey(config.vapidPublicKey),
	});
	return apiJson.post("/api/push/devices", { name: deviceName.trim(), subscription: requireSubscriptionJson(browserSubscription.toJSON()) });
}

function unavailableMessage(support: BrowserSupport, configLoading: boolean, available: boolean | undefined) {
	if (support === "unsupported") return "This browser or connection does not support secure push notifications.";
	if (support === "install-required") return "On iPhone or iPad, add Lumimail to your Home Screen before enabling notifications.";
	if (support === "denied") return "Notifications are blocked. Allow them in your browser or device settings, then return here.";
	if (!configLoading && !available) return "Push notifications are not configured on this Lumimail server.";
	return null;
}

function supportAfterEnableError(error: unknown): BrowserSupport | null {
	if (!(error instanceof Error)) return null;
	if (error.message === "denied") return "denied";
	if (error.message === "not-granted") return "supported";
	return null;
}

function canEnableNotifications(support: BrowserSupport, available: boolean | undefined, deviceName: string, pending: boolean) {
	return support === "supported" && !!available && !!deviceName.trim() && !pending;
}

export function NotificationSettingsClient({ initialSupport = "checking" }: { initialSupport?: BrowserSupport } = {}) {
	const queryClient = useQueryClient();
	const [support, setSupport] = useState<BrowserSupport>(initialSupport);
	const [deviceName, setDeviceName] = useState("");
	const [status, setStatus] = useState("");
	useEffect(() => setSupport(detectBrowserSupport()), []);

	const config = useQuery({
		queryKey: ["push-config"],
		queryFn: () => apiJson.get<PushConfig>("/api/push/config"),
	});
	const devices = useQuery({
		queryKey: ["push-devices"],
		queryFn: () => apiJson.get<{ devices: Device[] }>("/api/push/devices"),
	});
	const mailboxes = useQuery({
		queryKey: ["mailboxes"],
		queryFn: () => apiJson.get<{ mailboxes: Mailbox[] }>("/api/mailboxes"),
	});
	const enable = useMutation({
		mutationFn: async () => {
			try {
				return await enableNotifications(config.data, deviceName);
			} catch (error) {
				const nextSupport = supportAfterEnableError(error);
				if (nextSupport) setSupport(nextSupport);
				throw error;
			}
		},
		onSuccess: async () => {
			setDeviceName("");
			setStatus("Notifications enabled. Choose mailboxes below; all start off.");
			await queryClient.invalidateQueries({ queryKey: ["push-devices"] });
		},
		meta: { suppressErrorToast: true },
	});

	const unavailable = unavailableMessage(support, config.isLoading, config.data?.available);

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-2xl font-semibold text-ink">Notifications</h2>
				<p className="mt-1 text-sm text-ink-muted">Receive generic new-mail alerts without sending message content to the push service.</p>
			</div>
			<section className="space-y-4 rounded-lg border border-border p-4">
				<div className="flex items-start gap-3">
					<Bell className="mt-0.5 h-5 w-5 text-accent" aria-hidden />
					<div><h3 className="font-semibold text-ink">Enable this device</h3><p className="text-sm text-ink-muted">Permission is requested only when you press Enable. No mailbox is selected automatically.</p></div>
				</div>
				{unavailable && <p role="alert" className="rounded-md bg-surface-subtle p-3 text-sm text-ink-muted">{unavailable}</p>}
				<div className="grid gap-2 sm:max-w-md">
					<Label htmlFor="push-device-name">Device name</Label>
					<Input id="push-device-name" maxLength={64} placeholder="My laptop" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
				</div>
				<Button disabled={!canEnableNotifications(support, config.data?.available, deviceName, enable.isPending)} onClick={() => enable.mutate()}>
					<Bell className="h-4 w-4" />{enable.isPending ? "Enabling…" : "Enable notifications"}
				</Button>
				{enable.isError && <p role="alert" className="text-sm text-danger">{enable.error.message}</p>}
			</section>

			{status && <p role="status" className="text-sm text-success">{status}</p>}
			<section className="space-y-3">
				<h3 className="font-semibold text-ink">Your devices</h3>
				{devices.isLoading && <p role="status" className="text-sm text-ink-muted">Loading devices…</p>}
				{devices.isError && <p role="alert" className="text-sm text-danger">{devices.error.message}</p>}
				{!devices.isLoading && (devices.data?.devices.length ?? 0) === 0 && (
					<div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted"><BellOff className="mx-auto mb-2 h-5 w-5" />No notification devices are enrolled.</div>
				)}
				<div className="grid gap-4 lg:grid-cols-2">
					{devices.data?.devices.map((device) => (
						<NotificationDeviceCard key={device.id} device={device} mailboxes={mailboxes.data?.mailboxes ?? []} onChanged={async (message) => {
							setStatus(message);
							await queryClient.invalidateQueries({ queryKey: ["push-devices"] });
						}} />
					))}
				</div>
			</section>
		</div>
	);
}

function ActiveNotificationDevice({ device, mailboxes, preferences, renaming, newName, pending, error, onPreferencesChange, onRenamingChange, onNameChange, onRename, onSave, onRevoke }: {
	device: Device; mailboxes: Mailbox[]; preferences: string[]; renaming: boolean; newName: string; pending: boolean; error: unknown;
	onPreferencesChange: (ids: string[]) => void; onRenamingChange: (value: boolean) => void; onNameChange: (value: string) => void;
	onRename: () => void; onSave: () => void; onRevoke: () => void;
}) {
	return <>
		{renaming ? <div className="space-y-2"><Label htmlFor={`rename-${device.id}`}>New device name</Label><Input id={`rename-${device.id}`} maxLength={64} value={newName} onChange={(event) => onNameChange(event.target.value)} /><div className="flex flex-wrap gap-2"><Button size="sm" disabled={!newName.trim() || pending} onClick={onRename}>Save device name</Button><Button size="sm" variant="outline" onClick={() => onRenamingChange(false)}>Cancel</Button></div>{error ? <p role="alert" className="text-sm text-danger">{error instanceof Error ? error.message : "Device name could not be saved."}</p> : null}</div> : <Button size="sm" variant="outline" aria-label={`Rename ${device.name}`} onClick={() => onRenamingChange(true)}><Pencil className="h-4 w-4" />Rename</Button>}
		<fieldset className="space-y-2"><legend className="text-sm font-medium text-ink">Mailboxes</legend>{mailboxes.length === 0 ? <p className="text-sm text-ink-muted">No readable mailboxes are available.</p> : mailboxes.map((mailbox) => { const label = mailbox.displayName || `${mailbox.localPart}@${mailbox.hostname}`; return <label key={mailbox.id} className="flex min-h-9 items-center gap-3 rounded-md px-2 text-sm hover:bg-surface-subtle"><input type="checkbox" checked={preferences.includes(mailbox.id)} onChange={(event) => onPreferencesChange(event.target.checked ? [...preferences, mailbox.id] : preferences.filter((id) => id !== mailbox.id))} /><span>{label} <span className="text-ink-muted">({mailbox.localPart}@{mailbox.hostname})</span></span></label>; })}</fieldset>
		<Button size="sm" disabled={pending} onClick={onSave}>Save mailbox notifications</Button>
		<Button size="sm" variant="outline" aria-label={`Revoke ${device.name}`} onClick={onRevoke}><ShieldOff className="h-4 w-4" />Revoke</Button>
	</>;
}

function NotificationDeviceCard({ device, mailboxes, onChanged }: {
	device: Device;
	mailboxes: Mailbox[];
	onChanged: (message: string) => Promise<void>;
}) {
	const [preferences, setPreferences] = useState(device.mailboxIds);
	const [renaming, setRenaming] = useState(false);
	const [newName, setNewName] = useState(device.name);
	const [revokeOpen, setRevokeOpen] = useState(false);
	const [password, setPassword] = useState("");
	useEffect(() => setPreferences(device.mailboxIds), [device.mailboxIds]);
	useEffect(() => setNewName(device.name), [device.name]);

	const savePreferences = useMutation({
		mutationFn: () => apiJson.put(`/api/push/devices/${device.id}/preferences`, { mailboxIds: [...preferences].sort() }),
		onSuccess: () => onChanged("Preferences saved."),
		meta: { suppressErrorToast: true },
	});
	const rename = useMutation({
		mutationFn: () => apiJson.patch(`/api/push/devices/${device.id}`, { name: newName.trim() }),
		onSuccess: async () => { setRenaming(false); await onChanged("Device name saved."); },
		meta: { suppressErrorToast: true },
	});
	const revoke = useMutation({
		mutationFn: async () => {
			await apiJson.post("/api/auth/reconfirm", { password });
			await apiJson.delete(`/api/push/devices/${device.id}`);
			try {
				const registration = await navigator.serviceWorker.ready;
				const current = await registration.pushManager.getSubscription();
				await current?.unsubscribe();
			} catch {
				// Server revocation is authoritative; browser cleanup is best effort.
			}
		},
		onSuccess: async () => { setRevokeOpen(false); setPassword(""); await onChanged("Device revoked."); },
		meta: { suppressErrorToast: true },
	});

	return (
		<article className="min-w-0 space-y-4 rounded-lg border border-border p-4">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Laptop className="h-4 w-4 text-ink-muted" /><h4 className="break-words font-semibold text-ink">{device.name}</h4>{device.current && <Badge variant="outline">This device</Badge>}</div><p className="mt-1 text-xs text-ink-muted">Added {new Date(device.createdAt).toLocaleString()}</p></div>
				<Badge variant={device.status === "active" ? "success" : "secondary"}>{device.status}</Badge>
			</div>
			{device.status === "active" && <ActiveNotificationDevice device={device} mailboxes={mailboxes}
				preferences={preferences} renaming={renaming} newName={newName}
				pending={rename.isPending || savePreferences.isPending} error={rename.error ?? savePreferences.error}
				onPreferencesChange={setPreferences} onRenamingChange={setRenaming} onNameChange={setNewName}
				onRename={() => rename.mutate()} onSave={() => savePreferences.mutate()}
				onRevoke={() => { setRevokeOpen(true); revoke.reset(); }} />}
			{device.lastDeliveredAt && <p className="text-xs text-ink-muted">Last delivered {new Date(device.lastDeliveredAt).toLocaleString()}</p>}
			<Dialog open={revokeOpen} onOpenChange={(open) => { setRevokeOpen(open); if (!open) setPassword(""); }}><DialogContent><DialogHeader><DialogTitle>Revoke {device.name}?</DialogTitle><DialogDescription>This immediately stops server delivery. Confirm your password to continue.</DialogDescription></DialogHeader><div className="space-y-2"><Label htmlFor={`revoke-${device.id}`}>Password</Label><Input id={`revoke-${device.id}`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div>{revoke.isError && <p role="alert" className="text-sm text-danger">{revoke.error.message}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRevokeOpen(false)}>Cancel</Button><Button variant="destructive" disabled={!password || revoke.isPending} onClick={() => revoke.mutate()}>{revoke.isPending ? "Revoking…" : "Revoke device"}</Button></div></DialogContent></Dialog>
		</article>
	);
}
