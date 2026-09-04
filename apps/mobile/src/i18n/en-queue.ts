/**
 * English strings for the Action Queue.
 *
 * Copy discipline for M5: a Tamanor DECISION and a PLATFORM ACTION are described
 * separately and never merged. Approve copy must not promise that a public comment
 * will be hidden — mobile records a decision; execution stays behind Tamanor's
 * existing approval and execution controls.
 */
export const enQueue = {
  queue: {
    /** The model's confidence in its own read. A LABEL — never a blocked reason. */
    confidence: "Confidence",
    title: "Alerts",
    subtitle: "Actions Tamanor is proposing for your accounts.",
    activeCount: (n: number) => `${n} need${n === 1 ? "s" : ""} attention`,
    needsDecision: "Needs your decision",
    proposes: "Tamanor proposes",
    loadMore: "Load more",
    loadMoreFailed: "Couldn't load more.",
    endOfList: "That's everything.",
    openComment: "Open comment",
    openReview: "Open review",
    relatedUnavailable: "The original item is no longer available.",

    tabs: {
      active: "Active",
      approval: "Approval",
      blocked: "Blocked",
      resolved: "Resolved",
      all: "History",
    },

    /** Section headings on the detail screen. */
    sections: {
      content: "Content",
      proposal: "Proposal",
      risk: "Risk & reason",
      policy: "Policy & safety",
      execution: "Platform action",
      decision: "Tamanor decision",
      readiness: "Readiness",
      activity: "Activity",
    },

    proposedAction: {
      notify: "Notify the team",
      create_inbox_item: "Add to the inbox",
      suggest_reply: "Suggest a reply",
      request_approval: "Request approval",
      hide_comment: "Hide the comment",
      report: "Report to the platform",
      escalate: "Escalate",
      assign_to_user: "Assign to a person",
      create_incident: "Open an incident",
      no_action: "No action",
    },

    state: {
      suggested: "Suggested",
      approval_required: "Waiting for approval",
      approved: "Approved",
      rejected: "Rejected",
      blocked_by_safety: "Held by safety rules",
      dry_run: "Dry run",
      executed: "Executed",
      failed: "Failed",
      rollback_needed: "Needs rollback",
      monitor: "Monitoring",
      no_action: "Resolved",
    },

    execution: {
      none: "Nothing has run on the platform.",
      blocked: "Blocked before running",
      dry_run: "Dry run only — nothing was changed publicly",
      executed: "Executed on the platform",
      failed: "Failed on the platform",
      rollback_pending: "Rollback pending",
      rolled_back: "Rolled back",
      byApproval: "after approval",
      byAutonomous: "by an automatic policy",
    },

    readiness: {
      blocked: "Not ready to run",
      dry_run: "Prepared as a dry run",
      live_possible: "Ready to run",
      already_executed: "Already run",
      not_applicable: "No platform action needed",
      note: "This is status only. Running an action on the platform is done from tamanor.com.",
    },

    lifecycle: {
      visible: "Still visible publicly",
      hidden: "Hidden on the platform",
      deleted: "No longer on the platform",
      cannot_hide: "The platform will not allow hiding this",
      unknown: "Public status unknown",
    },

    reason: {
      global_disabled: "Platform actions are switched off",
      facebook_hide_disabled: "Hiding is switched off for Facebook",
      unsupported_platform: "This platform does not support the action",
      account_is_demo: "This is a demo account",
      account_not_active: "The account is not active",
      reconnect_required: "The account needs reconnecting",
      token_not_healthy: "The account's permissions need attention",
      token_expired: "The account's access has expired",
      unhealthy_account: "The account is not healthy",
      missing_permission: "A required permission is missing",
      safety_never_autonomous: "Safety rules never automate this category",
      category_not_eligible: "This category is not eligible for the action",
      policy_not_autonomous: "The policy is not set to automatic",
      low_confidence: "Confidence was too low",
      threat_requires_critical: "Threats only qualify at high or critical risk",
      missing_comment_id: "The original comment could not be identified",
      dry_run_mode: "Dry-run mode",
      dry_run_still_enabled: "Dry-run mode is still on",
      live_not_enabled: "Live actions are not enabled",
      live_confirm_required: "Live actions need explicit confirmation",
      already_executed: "This action already ran",
      comment_deleted_or_unavailable: "The comment no longer exists",
      provider_error: "The platform returned an error",
      unavailable: "Reason unavailable",
    },

    /** Canonical audit events, as an operator would describe them. */
    activityEvent: {
      "approval.approved": "Approved in Tamanor",
      "approval.rejected": "Rejected in Tamanor",
      "approval.resolved": "Marked as handled",
      "approval.retried": "Retried",
      "platform_action.live_requested": "Live action requested",
      "platform_action.executed": "Executed on the platform",
      "platform_action.blocked": "Blocked before running",
      "feedback.created": "Feedback recorded",
      "incident.created": "Incident opened",
    },

    policy: {
      mode: "Policy mode",
      modeValue: { monitor: "Monitor", assist: "Assist", approval: "Approval", autonomous: "Automatic" },
      neverAutonomous: "This category is never handled automatically.",
      autonomousEligible: "This category can be handled automatically under an automatic policy.",
      notEligible: "This category is not eligible for automatic handling.",
    },

    actions: {
      approve: "Approve",
      reject: "Reject",
      resolve: "Mark handled",
      approving: "Approving…",
      rejecting: "Rejecting…",
      resolving: "Saving…",
      cancel: "Cancel",
      confirm: "Confirm",
    },

    confirm: {
      approveTitle: "Approve this proposal?",
      approveBody:
        "This records your approval in Tamanor. It does not hide or delete anything on the platform — any platform action still runs through Tamanor's existing safety and execution controls.",
      rejectTitle: "Reject this proposal?",
      rejectBody:
        "This records your rejection in Tamanor. No platform action will be run from this decision.",
      resolveTitle: "Mark this as handled?",
      resolveBody:
        "This closes the item in your Tamanor queue. It does not change or remove the public comment.",
    },

    result: {
      approved: "Approved.",
      rejected: "Rejected.",
      resolved: "Marked as handled.",
      conflict: "Someone else already decided this item. Showing the current state.",
      permissionDenied: "You don't have permission to decide this.",
      readOnly: "Your access is read-only, so this can't be changed.",
      failed: "That didn't work. Please try again.",
      notFound: "This alert is no longer available.",
    },

    empty: {
      activeTitle: "No active alerts",
      activeBody: "Nothing needs your attention right now.",
      approvalTitle: "Nothing waiting for approval",
      approvalBody: "Proposals that need a decision will appear here.",
      blockedTitle: "No blocked actions",
      blockedBody: "Actions held back by safety rules will appear here.",
      resolvedTitle: "Nothing resolved yet",
      resolvedBody: "Decided and completed items will appear here.",
      allTitle: "No action history yet",
      allBody: "Everything Tamanor proposes will be listed here.",
    },

    notFoundTitle: "Alert unavailable",
    notFoundBody: "This alert no longer exists, or you don't have access to it.",
    noPermission: "You don't have permission to decide on alerts.",
  },
};
