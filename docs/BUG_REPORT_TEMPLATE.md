# Guardora.ai — Bug Report Template

Copy this block for each issue. Keep it factual and reproducible.

```markdown
### Title
<one line describing the problem>

### Route / page
<e.g. /dashboard/inbox, /sk/case-studies>

### Language
<EN / SK / DE>

### Browser / device
<e.g. Chrome 126 macOS / Safari iOS 17 iPhone 14>

### Environment
<local dev / staging / other — include commit hash if known>

### Steps to reproduce
1.
2.
3.

### Expected result
<what should happen>

### Actual result
<what actually happened>

### Screenshot / video
<attach or link>

### Console / server error
<paste any browser console error or server log; NEVER include tokens/secrets>

### Severity
<blocker / high / medium / low>

### Was real Meta sync involved?
<yes / no — if yes, note that no moderation action should ever be executed>

### Was demo data involved?
<yes / no — demo comment content may be English; that is expected>

### Proposed fix / note
<optional>
```

Notes:
- Never paste access tokens or secrets. Tokens must never appear in UI/logs; if
  you ever see one, that itself is a **blocker** bug.
- English demo comment content and platform/brand names are expected — report
  only English **UI chrome** as a localization bug.

Related: [BETA_CHECKLIST.md](./BETA_CHECKLIST.md) · [TEST_RESULTS.md](./TEST_RESULTS.md)
