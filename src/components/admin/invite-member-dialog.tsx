"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInviteCreated: () => void;
  initialInviteLink?: string | null;
  initialDeliveryStatus?: "not_sent" | "sending" | "sent" | "failed" | null;
};

export function InviteMemberDialog({ open, onOpenChange, onInviteCreated, initialInviteLink = null, initialDeliveryStatus = null }: Props) {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(initialInviteLink);
  const [copied, setCopied] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState<"not_sent" | "sending" | "sent" | "failed" | null>(initialDeliveryStatus);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/org/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role }),
    });
    const json = (await res.json()) as {
      success: boolean;
      data?: { invite: { token: string; deliveryStatus: "not_sent" | "sending" | "sent" | "failed" } };
      error?: { message: string };
    };
    setLoading(false);
    if (!res.ok || !json.success) {
      setError(typeof json.error?.message === "string" ? json.error.message : t("createInviteFailed"));
      return;
    }
    const link = `${window.location.origin}/register?token=${json.data!.invite.token}`;
    setInviteLink(link);
    setDeliveryStatus(json.data!.invite.deliveryStatus);
    onInviteCreated();
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClose() {
    setEmail("");
    setRole("member");
    setError(null);
    setInviteLink(null);
    setCopied(false);
    setDeliveryStatus(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("inviteMember")}</DialogTitle>
        </DialogHeader>
        {inviteLink ? (
          <div className="space-y-4">
            <p className={`rounded-md px-3 py-2 text-sm font-medium ${deliveryStatus === "sent" ? "bg-success-muted text-success" : "bg-warning-muted text-warning"}`}>
              {deliveryStatus === "sent" ? "Invitation sent" : deliveryStatus === "failed" ? "Email delivery failed — share the link below" : "Delivery is unconfirmed — share the link below"}
            </p>
            <p className="text-sm text-ink-muted">
              {t("inviteShareLink", { email, role })}
            </p>
            <div className="flex items-center gap-2">
              <Input value={inviteLink} readOnly className="flex-1" />
              <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? tCommon("copied") : tCommon("copy")}
              </Button>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={handleClose}>
              {tCommon("close")}
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("inviteEmailLabel")}</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("inviteEmailPlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">{t("inviteRoleLabel")}</Label>
              <Select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as "admin" | "member")}
                
              >
                <option value="member">{t("roleMember")}</option>
                <option value="admin">{t("roleAdmin")}</option>
              </Select>
              <p className="text-xs text-ink-muted">
                {t("inviteRoleHint")}
              </p>
            </div>
            {error && (
              <p className="rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
              {loading ? "Sending…" : "Send invitation"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
