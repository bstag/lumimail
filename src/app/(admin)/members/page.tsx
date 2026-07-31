"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { Mail, Clock, Plus, X } from "lucide-react";
import { apiJson } from "@/lib/api/client-response";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InviteMemberDialog } from "@/components/admin/invite-member-dialog";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";

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
};

const ROLE_BADGES: Record<string, string> = {
  owner: "bg-warning-muted text-warning",
  admin: "bg-accent-muted text-accent",
  member: "bg-surface-subtle text-ink-muted",
};

/** Organization-member queries are page-local; register in query-keys.ts if shared. */
const orgMemberKeys = {
  all: ["org-members"] as const,
};

function errorText(error: unknown, fallback: string): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : fallback;
}

export default function MembersPage() {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const format = useFormatter();
  const qc = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const membersQuery = useQuery({
    queryKey: orgMemberKeys.all,
    queryFn: () =>
      apiJson.get<{ members?: Member[]; invites?: Invite[] }>("/api/org/members"),
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

  const members = membersQuery.data?.members ?? [];
  const invites = membersQuery.data?.invites ?? [];
  const error =
    errorText(membersQuery.error, t("loadMembersFailed")) ??
    errorText(changeRole.error, t("changeRoleFailed")) ??
    errorText(removeMember.error, t("removeMemberFailed"));

  if (membersQuery.isLoading) {
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

      {invites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">{t("pendingInvites")}</h3>
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
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGES[invite.role]}`}>
                  {invite.role}
                </span>
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
