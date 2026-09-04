/**
 * Slovak strings. Wording follows the web product's `sk` copy where an equivalent
 * exists, so the two surfaces read identically.
 */
import type { Dictionary } from "./en";

import { skInbox } from "./sk-inbox";
import { skQueue } from "./sk-queue";
import { skAccounts } from "./sk-accounts";
import { skOauth } from "./sk-oauth";

export const sk: Dictionary = {
  ...skInbox,
  ...skQueue,
  ...skOauth,
  nav: {
    overview: "Prehľad",
    comments: "Komentáre",
    accounts: "Účty",
    alerts: "Upozornenia",
    more: "Viac",
    activity: "Aktivita",
    rules: "Pravidlá ochrany",
    billing: "Fakturácia",
    settings: "Nastavenia",
    team: "Tím",
  },
  common: {
    /** The `+not-found` screen — reachable from an unknown `tamanor://` deep link. */
    notFoundTitle: "Stránka sa nenašla",
    notFoundBody: "Tento odkaz nikam v Tamanore nevedie.",
    notFoundAction: "Prejsť na začiatok",
    back: "Späť",
    retry: "Skúsiť znova",
    refresh: "Obnoviť",
    viewAll: "Zobraziť všetky",
    signOut: "Odhlásiť sa",
    loading: "Načítava sa",
    comingSoon: "Už čoskoro",
    comingSoonBody: "Táto sekcia pribudne v ďalšej aktualizácii. Všetko už funguje na tamanor.com.",
    unlimited: "Neobmedzené",
    of: "z",
  },
  dashboard: {
    /** Dashboard-specific. The generic title lives at `errors.title`. */
    errorTitle: "Nepodarilo sa načítať prehľad",
    eyebrow: "Prehľad",
    greeting: "Vitajte späť",
    subtitle: "Tu je prehľad ochrany vašej reputácie dnes.",
    vsPrev: "vs. predch. obdobie",
    timeframe: (days: number) => `${days}d`,
    timeframeA11y: (days: number) => `Zobraziť posledných ${days} dní`,
    realTestMode: "Reálny testovací režim",
    realTestModeHint: "Zobrazujú sa iba reálne pripojené dáta.",
  },
  kpi: {
    analyzed: "Analyzované komentáre",
    risk: "Rizikové komentáre",
    autoHandled: "Automaticky ošetrené",
    pending: "Čakajúce na rozhodnutie",
    problem: "Účty s problémom",
    pendingHint: "Čaká na rozhodnutie",
    problemHint: "Vyžadujú pozornosť",
    noBaseline: "Zatiaľ bez porovnania",
    up: "nárast",
    down: "pokles",
  },
  accounts: {
    // M6 Accounts vocabulary, merged into the existing dashboard block so the
    // whole surface stays under one `t.accounts.*` namespace.
    ...skAccounts.accounts,
    section: "Strážené účty",
    comments: "Komentáre",
    risky: "Rizikové",
    autoHide: "Auto-skrývanie",
    on: "Zapnuté",
    off: "Vypnuté",
    lastSync: "Synchronizované",
    neverSync: "Zatiaľ nesynchronizované",
    showingOf: (shown: number, total: number) => `Zobrazených ${shown} z ${total}`,
    status: {
      active: "Aktívny",
      permissions_expired: "Oprávnenie expirovalo",
      sync_failed: "Vyžaduje pozornosť",
      monitoring_off: "Monitorovanie vypnuté",
      demo: "Demo",
    },
  },
  protection: {
    section: "Úroveň ochrany",
    scoreOf: (score: number) => `${score} zo 100`,
    strong: "Silná",
    partial: "Čiastočná",
    weak: "Vyžaduje zlepšenie",
    state: { ok: "V poriadku", partial: "Čiastočne", off: "Vypnuté" },
    checks: {
      metaPermissionsHealthy: "Oprávnenia platforiem",
      syncHealthy: "Synchronizácia",
      rulesActive: "Pravidlá ochrany",
      dangerousLinksHandled: "Nebezpečné odkazy",
      fraudProtection: "Ochrana pred podvodmi",
      reviewWorkflow: "Proces kontroly",
      actionConfigured: "Nastavená akcia",
    },
  },
  trend: {
    section: "Rizikové komentáre",
    description: "Vývoj za zvolené obdobie.",
    empty: "Za toto obdobie žiadne rizikové komentáre.",
    summary: (total: number, days: number) => `${total} rizikových komentárov za posledných ${days} dní.`,
    peak: (count: number, day: string) => `Najvyšší deň: ${count} dňa ${day}.`,
  },
  activity: {
    section: "Aktuálna aktivita",
    empty: "Zatiaľ žiadna aktivita.",
    types: {
      "sync.completed": "Synchronizácia dokončená",
      "sync.failed": "Synchronizácia zlyhala",
      "auto_protect.would_auto_hide": "Komentár označený na skrytie",
      "protection.action_executed": "Komentár skrytý",
      "incident.created": "Vytvorený incident",
      "proposal.created": "Navrhnutá akcia",
      "account.connected": "Účet pripojený",
      "token.expired": "Oprávnenia expirovali",
    },
  },
  empty: {
    title: "Poďme ochrániť váš prvý účet",
    body: "Pripojte sociálny účet a Tamanor začne okamžite sledovať rizikové komentáre.",
    hint: "Účty môžete pripojiť na tamanor.com — mobilný postup pribudne čoskoro.",
    cta: "Pripojiť účet",
  },
  access: {
    restricted:
      "Vaša skúšobná verzia alebo predplatné skončilo — ste v obmedzenom režime iba na čítanie. Vyberte plán a obnovte plný prístup.",
    past_due: "Posledná platba zlyhala. Aktualizujte platobnú metódu, aby ste si zachovali plný prístup.",
    trial_ending: (days: number) => `Skúšobná verzia — zostáva ${days} dní.`,
    cta: "Prejsť na fakturáciu",
  },
  errors: {
    title: "Niečo sa nepodarilo",
    network: "Žiadne pripojenie. Skontrolujte sieť a skúste znova.",
    timeout: "Tamanor odpovedal príliš dlho. Skúste to znova.",
    server: "Na našej strane nastala chyba. Skúste to znova.",
    forbidden: "K tomuto pracovnému priestoru nemáte na mobile prístup.",
    config: "Táto verzia aplikácie nie je nastavená na spojenie s Tamanor.",
  },
  usage: {
    processedItems: "Spracované komentáre",
    accounts: "Pripojené účty",
  },
};
