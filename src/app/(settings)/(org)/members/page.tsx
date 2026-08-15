"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { Mail, Clock, KeyRound, Plus, ShieldCheck, X } from "lucide-react";
import { apiJson } from "@/lib/api/client-response";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InviteMemberDialog } from "@/components/admin/invite-member-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { mailboxCapabilities, type AccessCapability, type AccessMailboxRole, type AccessOverview, type OrganizationRole } from "@/lib/access-overview";
import type { SessionOverview } from "@/lib/session-overview";
import type { SecurityAuditHistory } from "@/lib/security-audit-history";
import { useAuthSession } from "@/components/auth/auth-session-context";

type Member = {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

type Invite = {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  createdAt: string;
  status: "pending" | "expired" | "accepted";
  deliveryStatus: "not_sent" | "sending" | "sent" | "failed";
  lastDeliveryAttemptAt: string | null;
  lastDeliveredAt: string | null;
  acceptedAt: string | null;
};

type ResentInvite = { email: string; link: string; deliveryStatus: Invite["deliveryStatus"] };

const ROLE_BADGES: Record<string, string> = {
  owner: "bg-warning-muted text-warning",
  admin: "bg-accent-muted text-accent",
  member: "bg-surface-subtle text-ink-muted",
};

/** Organization-member queries are page-local; register in query-keys.ts if shared. */
const orgMemberKeys = {
  all: ["org-members"] as const,
};

const accessOverviewKeys = {
  all: ["admin", "access-overview"] as const,
};

const sessionOverviewKeys = {
  all: ["admin", "sessions"] as const,
};

const securityHistoryKeys = {
  all: ["admin", "security-events"] as const,
};

const ORGANIZATION_ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const MAILBOX_ROLE_LABELS: Record<AccessMailboxRole, string> = {
  viewer: "Viewer",
  responder: "Responder",
  manager: "Manager",
};

const CAPABILITY_LABELS: Record<AccessCapability, string> = {
  read: "Read",
  send: "Send",
  manage: "Manage",
};

type SessionRow = SessionOverview["sessions"][number];
type AccessMember = AccessOverview["members"][number];
type SessionRevocationTarget =
  | { mode: "one"; session: SessionRow }
  | { mode: "others" };

function errorText(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}

export default function MembersPage() {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const format = useFormatter();
  const authSession = useAuthSession();
  const isOwner = authSession?.user.role === "owner";
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [sessionRevocationTarget, setSessionRevocationTarget] = useState<SessionRevocationTarget | null>(null);
  const [sessionPassword, setSessionPassword] = useState("");
  const [bulkGrantTarget, setBulkGrantTarget] = useState<AccessMember | null>(null);
  const [bulkGrantMailboxIds, setBulkGrantMailboxIds] = useState<string[]>([]);
  const [bulkGrantRole, setBulkGrantRole] = useState<AccessMailboxRole>("responder");
  const [bulkGrantPassword, setBulkGrantPassword] = useState("");
  const [resentInvite, setResentInvite] = useState<ResentInvite | null>(null);

  const membersQuery = useQuery({
    queryKey: orgMemberKeys.all,
    queryFn: () =>
      apiJson.get<{ members?: Member[]; invites?: Invite[] }>("/api/org/members"),
  });
  const accessOverviewQuery = useQuery({
    queryKey: accessOverviewKeys.all,
    queryFn: () => apiJson.get<AccessOverview>("/api/admin/access-overview"),
  });
  const sessionOverviewQuery = useQuery({
    queryKey: sessionOverviewKeys.all,
    queryFn: () => apiJson.get<SessionOverview>("/api/admin/sessions"),
    enabled: isOwner,
  });
  const securityHistoryQuery = useInfiniteQuery({
    queryKey: securityHistoryKeys.all,
    queryFn: ({ pageParam }) => apiJson.get<SecurityAuditHistory>(
      pageParam ? `/api/admin/security-events?cursor=${encodeURIComponent(pageParam)}` : "/api/admin/security-events",
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isOwner,
  });

  const changeRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      apiJson.patch(`/api/org/members/${memberId}`, { role }),
    meta: { suppressErrorToast: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: orgMemberKeys.all }),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) => apiJson.delete(`/api/org/members/${memberId}`),
    meta: { suppressErrorToast: true },
    onSuccess: () => qc.invalidateQueries({ queryKey: orgMemberKeys.all }),
  });

  const revokeSessions = useMutation({
    mutationFn: async ({ target, password }: { target: SessionRevocationTarget; password: string }) => {
      await apiJson.post("/api/auth/reconfirm", { password });
      if (target.mode === "one") {
        return apiJson.delete<{ revokedCount: number; requestId: string }>(`/api/admin/sessions/${target.session.id}`);
      }
      return apiJson.post<{ revokedCount: number; requestId: string }>("/api/admin/sessions/revoke-others");
    },
    meta: { suppressErrorToast: true },
    onSuccess: async () => {
      setSessionRevocationTarget(null);
      setSessionPassword("");
      await qc.invalidateQueries({ queryKey: sessionOverviewKeys.all });
      await qc.invalidateQueries({ queryKey: securityHistoryKeys.all });
    },
  });

  const bulkGrant = useMutation({
    mutationFn: async ({
      targetUserId,
      mailboxIds,
      role,
      password,
    }: {
      targetUserId: string;
      mailboxIds: string[];
      role: AccessMailboxRole;
      password: string;
    }) => {
      await apiJson.post("/api/auth/reconfirm", { password });
      return apiJson.post<{ createdCount: number; requestId: string }>("/api/admin/mailbox-grants", {
        targetUserId,
        mailboxIds,
        role,
      });
    },
    meta: { suppressErrorToast: true },
    onSuccess: async () => {
      setBulkGrantTarget(null);
      setBulkGrantMailboxIds([]);
      setBulkGrantPassword("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: accessOverviewKeys.all }),
        qc.invalidateQueries({ queryKey: securityHistoryKeys.all }),
      ]);
    },
  });

  const resendInvite = useMutation({
    mutationFn: async (invite: Invite) => {
      const result = await apiJson.post<{ invite: { token: string; deliveryStatus: Invite["deliveryStatus"] } }>(
        `/api/org/invites/${invite.id}/resend`,
      );
      return {
        email: invite.email,
        link: `${window.location.origin}/register?token=${result.invite.token}`,
        deliveryStatus: result.invite.deliveryStatus,
      };
    },
    meta: { suppressErrorToast: true },
    onSuccess: async (result) => {
      setResentInvite(result);
      await qc.invalidateQueries({ queryKey: orgMemberKeys.all });
    },
  });

  function openSessionRevocation(target: SessionRevocationTarget) {
    revokeSessions.reset();
    setSessionPassword("");
    setSessionRevocationTarget(target);
  }

  function openBulkGrant(target: AccessMember) {
    bulkGrant.reset();
    setBulkGrantMailboxIds([]);
    setBulkGrantRole("responder");
    setBulkGrantPassword("");
    setBulkGrantTarget(target);
  }

  const members = membersQuery.data?.members ?? [];
  const invites = membersQuery.data?.invites ?? [];
  const error =
    errorText(membersQuery.error, t("loadMembersFailed")) ??
    errorText(accessOverviewQuery.error, "Failed to load access overview") ??
    (isOwner ? errorText(sessionOverviewQuery.error, "Failed to load active sessions") : null) ??
    (isOwner ? errorText(securityHistoryQuery.error, "Failed to load security history") : null) ??
    errorText(changeRole.error, t("changeRoleFailed")) ??
    errorText(removeMember.error, t("removeMemberFailed"));

  if (membersQuery.isLoading || accessOverviewQuery.isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-ink">{tNav("members")}</h2>
        <p className="text-sm text-ink-muted">{tCommon("loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title={tNav("members")}
        description={t("membersPageDesc")}
        action={
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("inviteMember")}
          </Button>
        }
      />

      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-sm text-danger">{error}</p>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t("removeMemberTitle")}
        description={
          removeTarget
            ? t("removeMemberDesc", { email: removeTarget.email })
            : ""
        }
        confirmLabel={t("removeMemberConfirm")}
        cancelLabel={tCommon("cancel")}
        danger
        onConfirm={() => {
          if (removeTarget) removeMember.mutate(removeTarget.id);
          setRemoveTarget(null);
        }}
      />

      <SessionRevocationDialog
        target={sessionRevocationTarget}
        password={sessionPassword}
        pending={revokeSessions.isPending}
        error={errorText(revokeSessions.error, "Failed to revoke session")}
        onPasswordChange={setSessionPassword}
        onOpenChange={(open) => {
          if (!open && !revokeSessions.isPending) {
            setSessionRevocationTarget(null);
            setSessionPassword("");
            revokeSessions.reset();
          }
        }}
        onConfirm={() => {
          if (sessionRevocationTarget && sessionPassword.length > 0) {
            revokeSessions.mutate({ target: sessionRevocationTarget, password: sessionPassword });
          }
        }}
      />

      <BulkGrantDialog
        target={bulkGrantTarget}
        mailboxes={accessOverviewQuery.data?.mailboxes ?? []}
        selectedMailboxIds={bulkGrantMailboxIds}
        role={bulkGrantRole}
        password={bulkGrantPassword}
        pending={bulkGrant.isPending}
        error={errorText(bulkGrant.error, "Failed to grant mailbox access")}
        onMailboxToggle={(mailboxId, selected) => {
          setBulkGrantMailboxIds((current) => selected
            ? [...current, mailboxId]
            : current.filter((id) => id !== mailboxId));
        }}
        onRoleChange={setBulkGrantRole}
        onPasswordChange={setBulkGrantPassword}
        onOpenChange={(open) => {
          if (!open && !bulkGrant.isPending) {
            setBulkGrantTarget(null);
            setBulkGrantMailboxIds([]);
            setBulkGrantPassword("");
            bulkGrant.reset();
          }
        }}
        onConfirm={() => {
          if (bulkGrantTarget && bulkGrantMailboxIds.length > 0 && bulkGrantPassword.length > 0) {
            bulkGrant.mutate({
              targetUserId: bulkGrantTarget.userId,
              mailboxIds: bulkGrantMailboxIds,
              role: bulkGrantRole,
              password: bulkGrantPassword,
            });
          }
        }}
      />

      <Dialog open={resentInvite !== null} onOpenChange={(open) => { if (!open) setResentInvite(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invitation resent</DialogTitle>
            <DialogDescription>The previous link is no longer valid.</DialogDescription>
          </DialogHeader>
          {resentInvite && (
            <div className="space-y-3">
              <p className={`rounded-md px-3 py-2 text-sm font-medium ${resentInvite.deliveryStatus === "sent" ? "bg-success-muted text-success" : "bg-warning-muted text-warning"}`}>
                {resentInvite.deliveryStatus === "sent" ? "Invitation sent" : resentInvite.deliveryStatus === "failed" ? "Email delivery failed — share this link" : "Delivery is unconfirmed — share this link"}
              </p>
              <p className="text-sm text-ink-muted">Fallback link for {resentInvite.email}</p>
              <Input value={resentInvite.link} readOnly />
              <Button variant="outline" className="w-full" onClick={() => { void navigator.clipboard.writeText(resentInvite.link); }}>Copy link</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-subtle text-sm font-medium text-ink-muted">
                {member.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-ink">{member.name}</p>
                <p className="text-xs text-ink-muted">{member.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {member.role === "owner" ? (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGES.owner}`}>
                  {t("roleOwner")}
                </span>
              ) : (
                <Select
                  value={member.role}
                  onChange={(e) => {
                    changeRole.mutate({ memberId: member.id, role: e.target.value });
                  }}
                  size="sm" className="w-auto"
                >
                  <option value="admin">{t("roleAdmin")}</option>
                  <option value="member">{t("roleMember")}</option>
                </Select>
              )}
              {member.role !== "owner" && (
                <button
                  type="button"
                  onClick={() => setRemoveTarget(member)}
                  className="text-ink-faint hover:text-danger"
                  title={t("removeMemberConfirm")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {accessOverviewQuery.data && (
        <AccessMatrix overview={accessOverviewQuery.data} canBulkGrant={isOwner} onManageAccess={openBulkGrant} />
      )}

      {isOwner && sessionOverviewQuery.isLoading && (
        <p className="text-sm text-ink-muted">Loading active sessions…</p>
      )}
      {isOwner && sessionOverviewQuery.data && (
        <SessionOverviewCard overview={sessionOverviewQuery.data} onRevoke={openSessionRevocation} />
      )}

      {isOwner && securityHistoryQuery.isLoading && (
        <p className="text-sm text-ink-muted">Loading security history…</p>
      )}
      {isOwner && securityHistoryQuery.data && (
		<div id="security" className="scroll-mt-6">
		<SecurityHistoryCard
          history={securityHistoryQuery.data.pages}
          members={members}
          hasNextPage={securityHistoryQuery.hasNextPage}
          loadingMore={securityHistoryQuery.isFetchingNextPage}
          onLoadMore={() => { void securityHistoryQuery.fetchNextPage(); }}
		/>
		</div>
      )}

      {invites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">Invitations</h3>
          {resendInvite.error && (
            <p className="rounded-md bg-danger-muted px-3 py-2 text-sm text-danger">
              {errorText(resendInvite.error, "Failed to resend invitation")}
            </p>
          )}
          {invites.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center justify-between rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-ink-faint" />
                <div>
                  <p className="text-sm text-ink-muted">{invite.email}</p>
                  <p className="text-xs text-ink-faint">
                    <Clock className="mr-1 inline h-3 w-3" />
                    {t("expires", {
                      date: format.dateTime(new Date(invite.expiresAt), {
                        year: "numeric",
                        month: "numeric",
                        day: "numeric",
                      }),
                    })}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {invite.acceptedAt
                      ? `Accepted ${format.dateTime(new Date(invite.acceptedAt), { dateStyle: "medium", timeStyle: "short" })}`
                      : invite.lastDeliveredAt
                        ? `Provider accepted ${format.dateTime(new Date(invite.lastDeliveredAt), { dateStyle: "medium", timeStyle: "short" })}`
                        : invite.lastDeliveryAttemptAt
                          ? `Last attempted ${format.dateTime(new Date(invite.lastDeliveryAttemptAt), { dateStyle: "medium", timeStyle: "short" })}`
                          : "No delivery attempted"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                  {invite.status === "pending" ? "Pending" : invite.status === "expired" ? "Expired" : "Accepted"}
                </span>
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                  {invite.deliveryStatus === "sent" ? "Invitation sent" : invite.deliveryStatus === "failed" ? "Delivery failed" : invite.deliveryStatus === "sending" ? "Delivery unconfirmed" : "Not sent"}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGES[invite.role]}`}>
                  {invite.role}
                </span>
                {invite.status !== "accepted" && (
                  <Button variant="outline" size="sm" disabled={resendInvite.isPending} onClick={() => resendInvite.mutate(invite)}>
                    Resend invitation
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <InviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInviteCreated={() => {
          void qc.invalidateQueries({ queryKey: orgMemberKeys.all });
        }}
      />
    </div>
  );
}

function SessionRevocationDialog({
  target,
  password,
  pending,
  error,
  onPasswordChange,
  onOpenChange,
  onConfirm,
}: {
  target: SessionRevocationTarget | null;
  password: string;
  pending: boolean;
  error: string | null;
  onPasswordChange: (password: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const others = target?.mode === "others";
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{others ? "Revoke all other sessions?" : "Revoke session?"}</DialogTitle>
          <DialogDescription>
            {others
              ? "Every other session in this organization will stop working immediately. Your current session stays active."
              : `This session${target?.mode === "one" ? ` for ${target.session.email}` : ""} will stop working immediately.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="session-revocation-password">Password</Label>
          <Input
            id="session-revocation-password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={pending}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={pending || password.length === 0} onClick={onConfirm}>
            {pending ? "Revoking…" : others ? "Revoke other sessions" : "Revoke session"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkGrantDialog({
  target,
  mailboxes,
  selectedMailboxIds,
  role,
  password,
  pending,
  error,
  onMailboxToggle,
  onRoleChange,
  onPasswordChange,
  onOpenChange,
  onConfirm,
}: {
  target: AccessMember | null;
  mailboxes: AccessOverview["mailboxes"];
  selectedMailboxIds: string[];
  role: AccessMailboxRole;
  password: string;
  pending: boolean;
  error: string | null;
  onMailboxToggle: (mailboxId: string, selected: boolean) => void;
  onRoleChange: (role: AccessMailboxRole) => void;
  onPasswordChange: (password: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const existingMailboxIds = new Set(target?.grants.map((grant) => grant.mailboxId) ?? []);
  const availableMailboxes = mailboxes.filter((mailbox) => !existingMailboxIds.has(mailbox.id));
  const capabilities = mailboxCapabilities(role).map((capability) => CAPABILITY_LABELS[capability]).join(" · ");

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant mailbox access</DialogTitle>
          <DialogDescription>
            Add access for {target?.name ?? "this member"}. Existing mailbox roles will not change.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-ink">Mailboxes</p>
            {availableMailboxes.length === 0 ? (
              <p className="mt-2 rounded-md bg-surface-subtle px-3 py-2 text-sm text-ink-muted">All mailboxes already have access</p>
            ) : (
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                {availableMailboxes.map((mailbox) => (
                  <label key={mailbox.id} className="flex items-start gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={selectedMailboxIds.includes(mailbox.id)}
                      disabled={pending}
                      onChange={(event) => onMailboxToggle(mailbox.id, event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border"
                    />
                    <span className="break-all">{mailbox.address}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-grant-role">Mailbox role</Label>
            <Select
              id="bulk-grant-role"
              value={role}
              disabled={pending}
              onChange={(event) => onRoleChange(event.target.value as AccessMailboxRole)}
            >
              <option value="viewer">Viewer</option>
              <option value="responder">Responder</option>
              <option value="manager">Manager</option>
            </Select>
            <p className="text-xs text-ink-muted">{capabilities}</p>
          </div>

          <p className="rounded-md bg-surface-subtle px-3 py-2 text-sm font-medium text-ink">
            {selectedMailboxIds.length} new {selectedMailboxIds.length === 1 ? "grant" : "grants"} for {target?.name ?? "member"}
          </p>

          <div className="space-y-2">
            <Label htmlFor="bulk-grant-password">Password</Label>
            <Input
              id="bulk-grant-password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={pending}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={pending || selectedMailboxIds.length === 0 || password.length === 0}
            onClick={onConfirm}
          >
            {pending ? "Granting…" : "Grant access"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SessionOverviewCard({ overview, onRevoke }: { overview: SessionOverview; onRevoke: (target: SessionRevocationTarget) => void }) {
  const format = useFormatter();
  const otherSessionCount = overview.sessions.filter((session) => !session.isCurrent).length;
  return (
    <section data-testid="session-overview" className="space-y-4 rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h3 className="text-base font-semibold text-ink">Active sessions</h3>
            <p className="mt-1 text-sm text-ink-muted">Sessions currently authorized for this organization.</p>
          </div>
        </div>
        <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-ink-muted">
          {overview.activeCount} active
        </span>
      </div>

      {otherSessionCount > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => onRevoke({ mode: "others" })}>
            Revoke all other sessions
          </Button>
        </div>
      )}

      {overview.sessions.length === 0 ? (
        <p className="rounded-md bg-surface-subtle px-3 py-2 text-sm text-ink-muted">No active sessions</p>
      ) : (
        <div className="space-y-2">
          {overview.sessions.map((session) => (
            <article key={session.id} className="rounded-lg border border-border bg-surface p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{session.name}</p>
                  <p className="break-all text-xs text-ink-muted">{session.email}</p>
                </div>
                {session.isCurrent && (
                  <span className="rounded-full bg-success-muted px-2.5 py-1 text-xs font-medium text-success">This session</span>
                )}
                {!session.isCurrent && (
                  <Button variant="outline" size="sm" onClick={() => onRevoke({ mode: "one", session })}>
                    Revoke this session
                  </Button>
                )}
              </div>
              <dl className="mt-3 grid gap-2 text-xs text-ink-muted sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-ink">Created</dt>
                  <dd>{format.dateTime(new Date(session.createdAt), { dateStyle: "medium", timeStyle: "short" })}</dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">Expires</dt>
                  <dd>{format.dateTime(new Date(session.expiresAt), { dateStyle: "medium", timeStyle: "short" })}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SecurityHistoryCard({
  history,
  members,
  hasNextPage,
  loadingMore,
  onLoadMore,
}: {
  history: SecurityAuditHistory[];
  members: Member[];
  hasNextPage: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const format = useFormatter();
  const events = history.flatMap((page) => page.events);
  const memberNames = new Map(members.map((member) => [member.userId, member.name]));

  return (
    <section data-testid="security-history" className="space-y-4 rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <h3 className="text-base font-semibold text-ink">Security history</h3>
          <p className="mt-1 text-sm text-ink-muted">Content-free records of security actions in this organization.</p>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="rounded-md bg-surface-subtle px-3 py-2 text-sm text-ink-muted">No security events yet</p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => {
            const actor = memberNames.get(event.actorUserId) ?? "Former member";
            const target = event.resourceId ? memberNames.get(event.resourceId) ?? "Former member" : "member";
            const action = event.action === "session.revoke"
              ? "revoked a session"
              : event.action === "session.revoke_others"
                ? `revoked ${event.affectedCount} other ${event.affectedCount === 1 ? "session" : "sessions"}`
                : `granted ${event.affectedCount} mailbox ${event.affectedCount === 1 ? "grant" : "grants"} to ${target}`;
            return (
              <article key={event.id} className="rounded-lg border border-border bg-surface p-3 sm:p-4">
                <p className="text-sm font-medium text-ink">{actor} {action}</p>
                <dl className="mt-2 grid gap-2 text-xs text-ink-muted sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-ink">When</dt>
                    <dd>{format.dateTime(new Date(event.createdAt), { dateStyle: "medium", timeStyle: "short" })}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-ink">Request ID</dt>
                    <dd className="break-all font-mono">{event.requestId}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading…" : "Load older events"}
          </Button>
        </div>
      )}
    </section>
  );
}

function AccessMatrix({
  overview,
  canBulkGrant,
  onManageAccess,
}: {
  overview: AccessOverview;
  canBulkGrant: boolean;
  onManageAccess: (member: AccessMember) => void;
}) {
  return (
    <section data-testid="access-matrix" className="space-y-4 rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <h3 className="text-base font-semibold text-ink">Access matrix</h3>
          <p className="mt-1 text-sm text-ink-muted">Workspace role does not grant mailbox access.</p>
        </div>
      </div>

      <div className="space-y-3">
        {overview.members.map((member) => (
          <article key={member.id} data-testid={`access-member-${member.userId}`} className="rounded-lg border border-border bg-surface p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-ink">{member.name}</p>
                <p className="break-all text-xs text-ink-muted">{member.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-ink-muted">
                  Workspace: {ORGANIZATION_ROLE_LABELS[member.organizationRole]}
                </span>
                {canBulkGrant && (
                  <Button variant="outline" size="sm" onClick={() => onManageAccess(member)}>Manage access</Button>
                )}
              </div>
            </div>

            {member.grants.length === 0 ? (
              <p className="mt-3 rounded-md bg-surface-subtle px-3 py-2 text-sm text-ink-muted">No mailbox access</p>
            ) : (
              <div className="mt-3 space-y-2">
                {member.grants.map((grant) => (
                  <div key={grant.id} className="flex flex-col gap-1 rounded-md bg-surface-subtle px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium text-ink">{grant.address}</p>
                      {grant.displayName && <p className="text-xs text-ink-muted">{grant.displayName}</p>}
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <p className="text-xs font-medium text-ink">{MAILBOX_ROLE_LABELS[grant.role]}</p>
                      <p className="text-xs text-ink-muted">{grant.capabilities.map((capability) => CAPABILITY_LABELS[capability]).join(" · ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <h4 className="text-sm font-semibold text-ink">Mailbox coverage</h4>
        {overview.mailboxes.length === 0 ? (
          <p className="text-sm text-ink-muted">No organization mailboxes</p>
        ) : overview.mailboxes.map((mailbox) => (
          <div key={mailbox.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="break-all text-ink">{mailbox.address}</span>
            <span className="text-ink-muted">{mailbox.assignedMemberCount} assigned</span>
          </div>
        ))}
      </div>
    </section>
  );
}
