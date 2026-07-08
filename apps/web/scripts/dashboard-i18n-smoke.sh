#!/usr/bin/env bash
# Dashboard i18n smoke test.
#
# Renders each dashboard route with SK and DE locale cookies and asserts that
# known English customer-facing phrases are NOT present in the HTML.
#
# ALLOWLIST (intentionally NOT flagged — kept English on purpose):
#   - Brand names: Aurora Fitness, Northwind Coffee, Konfigurátor
#   - Platform names: Facebook, Instagram, YouTube, LinkedIn, TikTok, Google
#   - Plan product names: Starter, Business, Agency, Enterprise
#   - Technical codes/acronyms: OAuth, API, UTC, KMS, SSO, SAML, SLA, META_*, sync.completed
#   - Demo comment CONTENT (reputation item text)
#   - German cognates identical to English (Status, Details, Admin, Analyst) — see DE_COGNATES
# The forbidden list below uses distinctive multi-word phrases + tag-wrapped enum
# labels to avoid false positives on the allowlist.
#
# Usage: BASE=http://localhost:3970 SID=<dev-user-id> [ITEM=<reputation-item-id>] bash dashboard-i18n-smoke.sh
set -u
BASE="${BASE:?set BASE (e.g. http://localhost:3970)}"
SID="${SID:?set SID (dev user id)}"
ITEM="${ITEM:-}"

ROUTES=(
  "/dashboard"
  "/dashboard/inbox"
  "/dashboard/accounts"
  "/dashboard/approvals"
  "/dashboard/rules"
  "/dashboard/insights"
  "/dashboard/reports"
  "/dashboard/billing"
  "/dashboard/team"
  "/dashboard/settings"
  "/dashboard/brands"
  "/dashboard/audit"
)
[ -n "$ITEM" ] && ROUTES+=("/dashboard/inbox/$ITEM")
[ -n "${PROP:-}" ] && ROUTES+=("/dashboard/approvals/$PROP")

# Forbidden English UI phrases. Substring match (grep -F). Word-boundary-ish
# phrases chosen to avoid false positives on platform/brand names.
PHRASES=(
  "Welcome back" "Received items" "High risk" "Pending approvals"
  "Connected accounts" "Last sync" "Risk trend" "Latest risky items"
  "Risk breakdown" "Platform breakdown" "Top risky topics" "Sync health"
  "Recent incidents" "Connect an account" "Free trial" "Choose a plan"
  "All time" "Awaiting review" "Across brands" "All items by level"
  ">Search<" ">Filter<" ">Status<" ">Priority<" ">Risk<" ">Actions<"
  ">Details<" ">Connect<" ">Disconnect<" ">Connected<" "Not connected"
  ">Reviews<" ">Comments<" ">Reply<" ">Hide<" ">Delete<" ">Approve<"
  ">Reject<" ">Execute<" "Create rule" "Add brand" "Invite member"
  "Manage billing" "Current plan" ">Audit log<" ">Created<" ">Updated<"
  "No items" ">Empty<" ">Loading<" ">Settings<" ">Language<"
  ">Content<" ">Ingested<" ">Brand<" ">Platform<" ">Event<" ">Actor<"
  ">Target<" ">Time<" ">Member<" ">Role<" ">Joined<"
  # approval / proposal detail
  "Original content" "Proposed action" "AI risk snapshot" ">Lifecycle<"
  "Review &amp; execution" "Review & execution" "Back to approval queue"
  "View item in inbox" "Captured when the proposal" "Proposed by"
  "API supported" "No further action"
  # rules page
  "phrase-based policies" "Words that should never appear"
  "Competitor names or handles" "Terms indicating a reputational crisis"
  "brand-specific phrases to watch" "One per line or comma-separated"
  "Rules feed the AI Risk Engine" "Go to brands" "Case-insensitive"
  # team page (role labels + descriptions)
  "Full control incl" "Manage brands, connectors" "Triage inbox"
  "approve proposals" "Read-only across the workspace"
  "Invitations are coming soon" ">Owner<" ">Viewer<" ">Reviewer<"
  # billing page
  "No card required" "trial allowance used" "Detailed billing"
  "No payment is processed" "Community support" "Approval workflow"
  "Email support" "Team roles" "Audit exports" "Priority support"
  "Dedicated support" "Data residency" "Unlimited accounts" "Unlimited brands"
  "connected accounts" "Read-only sync"
  # settings bodies
  "Names, languages, timezones" "Deterministic brand policies"
  "proposals run in the background" "Inbound platform events" "encrypted-at-rest"
  # brand form / enum display
  ">Professional<" ">Paused<" ">Archived<" ">Empathetic<"
)

# German B2B cognates that are legitimately identical to English — the correct
# German UI term is the same word (Status, Details). Skipped ONLY for de.
DE_COGNATES=(">Status<" ">Details<" ">Admin<" ">Analyst<")

is_de_cognate() {
  for c in "${DE_COGNATES[@]}"; do [ "$1" = "$c" ] && return 0; done
  return 1
}

overall=0
for route in "${ROUTES[@]}"; do
  for loc in sk de; do
    html=$(curl -s -b "guardora_session=$SID; guardora_locale=$loc" "$BASE$route")
    found=0
    for p in "${PHRASES[@]}"; do
      [ "$loc" = "de" ] && is_de_cognate "$p" && continue
      if printf '%s' "$html" | grep -qF "$p"; then
        echo "  ✗ [$loc] $route → EN phrase: \"$p\""
        found=1; overall=1
      fi
    done
    [ "$found" -eq 0 ] && echo "  ✓ [$loc] $route"
  done
done

echo ""
if [ "$overall" -eq 0 ]; then echo "PASS — dashboard i18n smoke (all routes)"; else echo "FAIL — dashboard i18n smoke"; fi
exit $overall
