# Child Safety Reviewer Console UI V1

The production-quality operator interface for authorized safety reviewers, built entirely on top of the
**Reviewer Workspace V1** backend (it consumes those APIs only — it adds no new backend logic, no new
canonical model, and no change to detector / intervention / escalation).

> A `SafetySignal` is content-free by construction. The console never renders detector payloads, raw
> message content, transcripts, or classifier scores — only coarse, canonical, content-free fields.

## Page structure

Under the business dashboard (same placement as cyberbullying), at `/dashboard/child-safety/reviewer`:

| Route | Purpose |
|---|---|
| `page.tsx` | **Console overview** — dashboard KPI cards + the incident data table (sort/filter/search/pagination) |
| `[incidentId]/page.tsx` | **Incident detail** — overview, signals, escalations, notifications, delivery, recovery, audit, execution ledger, timeline, notes, review actions |
| `loading.tsx` | skeleton loaders (cards + table) |
| `error.tsx` | error boundary — safe message + retry, never the raw error |

## Component hierarchy

```
page.tsx (server, permission-gated)
├─ <Unauthorized>            — proper 403 screen (rendered instead of the whole console)
├─ StatCard × 8             — dashboard KPIs
├─ <FilterBar> (client)     — rewrites URL search params (server re-renders the table)
└─ incident <table>         — server-rendered rows → link to detail

[incidentId]/page.tsx (server, permission-gated)
├─ status/severity/urgency/escalation <Badge>s + read-only marker
├─ <ReviewActions> (client) — assign / assign-to-me / unassign / status, with accessible dialogs   [manager only]
├─ overview / signals / escalations / notifications / execution ledger / audit  (server sections)
├─ <TimelineView> (server)  — renders the backend timeline IN ORDER (never re-sorts)
└─ <NotesPanel> (client)    — append-only notes, newest-first, markdown preview

reviewer-view.ts             — PURE view-model (tones, timeline map, state-machine mirror, formatting, safe markdown)
reviewer-i18n.ts             — en/sk/de copy + safe action-error contract
```

## Permissions

The console is gated by the backend permissions (`child_safety:review_view` / `_manage`):

- **View** (`canViewChildSafetyReview`) — Owner / Administrator / Safety Reviewer. Without it the **entire
  console is replaced** by `<Unauthorized>` (a proper 403 screen). No list, detail, dashboard, or action
  is ever mounted for an unauthorized user.
- **Manage** (`canManageChildSafetyReview`) — same roles. The `<ReviewActions>` bar and the add-note form
  are rendered **only** when `canManage`; a view-only reviewer sees a read-only marker and no action
  affordances. Every server action re-checks manage permission server-side (the UI gate is not the
  enforcement — it is the convenience layer over a fail-closed backstop).

## API usage

The console consumes the existing reviewer service via server components + server actions (the same
`ReviewerActor {tenantId, userId, role}` the API routes use):

| UI | Backend |
|---|---|
| overview cards | `getChildSafetyReviewerDashboard(actor)` |
| incident table | `listChildSafetyIncidents(actor, input)` (sort/filter/search/pagination) |
| detail | `getChildSafetyIncidentDetail(actor, incidentId)` |
| assign / unassign / note / status | `assign… / unassign… / addChildSafetyReviewerNote / setChildSafetyReviewStatus` |

No new endpoints, no new queries, no new tables. The API routes under `/api/v1/child-safety/reviewer/*`
remain available for programmatic use; the UI uses the service directly (SSR) + server actions (mutations).

## State management

- **URL is the source of truth for the list.** `<FilterBar>` (client) only rewrites search params; the
  server component re-renders the table from them. This keeps loading / empty / error states
  server-driven and the table a pure server render. Any filter change resets pagination.
- **Mutations are server actions** that call the reviewer service and `revalidatePath` the detail **and**
  the console overview — so the dashboard cards and the incident refresh automatically after every action
  (optimistic refresh). Each action returns a **safe, serializable error CODE** (localized client-side),
  never a raw message / stack / id.
- **Dialogs are local client state** (`useActionState` + `useState`); they are accessible
  (`role="dialog"`, `aria-modal`, focus-trapped, Esc / backdrop cancel — no `window.confirm`) and disabled
  while pending.

## Timeline

`<TimelineView>` renders the backend `timeline` array **in the order received** — the console never
re-sorts (the backend guarantees deterministic ordering). Each event is color-coded by category:

| Category | Tone | Example events |
|---|---|---|
| incident | brand | incident opened |
| signal | neutral/warn | signal linked, severity/urgency raised |
| escalation | danger | escalation triggered |
| notification | warn | internal notification sent |
| guardian | ok | guardian delivery |
| review | brand | assigned / unassigned / status changed / note added |
| recovery | warn | recovery repair |

Reviewer-note timeline entries carry only the opaque note id (never the body).

## Notes

Append-only. Newest-first. The add form (manager-only) has a live **markdown preview** rendered by an
**XSS-safe** renderer (HTML is escaped first; only bold / italic / inline-code / line-breaks are then
applied — never links, images, or raw HTML). There is **no edit and no delete** affordance — the backend
has no such path either.

## UX

Desktop-first, responsive (the table scrolls horizontally on narrow viewports; cards reflow 2→4 columns),
keyboard accessible (labelled controls, focus-trapped dialogs, `search`/`tablist` roles), dark-mode
compatible (all colors are design-system CSS variables), with skeleton loaders and optimistic refresh.

## Known limitations

- This sprint ships the console UI; it does not add a sidebar nav entry (reachable at
  `/dashboard/child-safety/reviewer`). The console lives under the business dashboard shell, consistent
  with cyberbullying's placement.
- The list's ranked (severity/urgency) sorts inherit the backend's most-recent-2000 bound.
- The markdown preview supports a deliberately minimal, safe subset (bold / italic / code / breaks).
- Assignment takes a reviewer user id (V1); a member picker is a future enhancement.
- No realtime push — the console refreshes on navigation and after actions (server revalidation).
- **Tamanor reduces risk and speeds intervention but cannot guarantee 100% protection.**
