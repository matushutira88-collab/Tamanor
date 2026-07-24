"use client";
/* eslint-disable @next/next/no-img-element */

/**
 * Tamanor landing — served at /, /sk, /de. Self-contained body (inline styles + a few
 * keyframes); the header and footer are the SHARED SiteHeader / SiteFooter so every public
 * page carries an identical header and footer.
 *
 * V2 (dual product): one engine, two products — Business (social account firewall) and
 * Families (guardian safety net). A morph toggle recolours the hero (blue <-> teal) and swaps
 * the product window; the rest of the page tells the shared-engine story and prices both.
 * Copy is a local trilingual map (same pattern as register/login), so the large i18n
 * dictionaries stay untouched. Illustrative people use the real /humans/* portraits.
 */

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "../site-header";
import { SiteFooter } from "../site-footer";
import { ShieldEmblem } from "../logo";
import type { Locale } from "@/i18n";
import { landingFaqs } from "./faqs";

/* ---------- palette ---------- */
const BIZ = { a: "#2563eb", a2: "#60a5fa", deep: "#1d4ed8", soft: "#eaf1ff" };
const FAM = { a: "#12b48f", a2: "#2fd6ac", deep: "#0e9377", soft: "#e6faf4" };
const C = {
  bg: "#f5f8fd", panel: "#ffffff", line: "#e6ecf5", line2: "#dbe3ef",
  ink: "#0e1726", dim: "#5a6a86", faint: "#8a99b4",
  red: "#e5484d", green: "#17a34a", amber: "#c07806",
};
const mono = "var(--font-mono-v2), ui-monospace, Menlo, monospace";
const disp = "var(--font-disp-v2), ui-sans-serif, system-ui, sans-serif";
const sans = "var(--font-sans-v2), ui-sans-serif, system-ui, sans-serif";

const KF = `
@keyframes tmr-bob { 50% { transform: translateY(-9px); } }
@keyframes tmr-scan { 0% { top:-14%; opacity:0; } 12% { opacity:.8; } 86% { opacity:.8; } 100% { top:106%; opacity:0; } }
@keyframes tmr-lp { 50% { opacity:.35; transform: scale(1.6); } }
.tmr-l2 details > summary { list-style:none; }
.tmr-l2 details > summary::-webkit-details-marker { display:none; }
.tmr-l2 details[open] .tmr-sign { transform: rotate(45deg); }
@media (max-width: 900px) { .tmr-l2 .tmr-cols { grid-template-columns: 1fr !important; } }
@media (max-width: 860px) { .tmr-l2 .tmr-cards { grid-template-columns: 1fr 1fr !important; } }
@media (max-width: 560px) { .tmr-l2 .tmr-cards { grid-template-columns: 1fr !important; } }
@media (prefers-reduced-motion: reduce) { .tmr-l2 [class*="tmr-anim"] { animation: none !important; } }
`;

/* ---------- portraits (real /humans/*) ---------- */
const IMG = {
  adam: "/humans/author.png", lena: "/humans/feed3.png",
  sofia: "/humans/feed5.png", jakub: "/humans/feed1.png",
  marketing: "/humans/marketing.png", support: "/humans/support.png",
  owner: "/humans/owner.png", teen: "/humans/actor3.png",
  parent: "/humans/person5.png", grand: "/humans/reviewer.png",
};

/* ---------- pricing (shared numbers; labels localised) ---------- */
const BIZ_PRICES: (number | null)[] = [59, 189, 499, null];
const FAM_PRICES: (number | null)[] = [7.99, 14.99, 24.99, null];

type Plan = { name: string; tagline: string; cta: string; features: string[] };
type Step = { name: string; body: string };
type Copy = {
  heroBiz: { eyebrow: string; l1: string; l2: string; lead: string; cta: string };
  heroFam: { eyebrow: string; l1: string; l2: string; lead: string; cta: string };
  oneEngine: string; twoProducts: string; pickWorld: string; secondary: string;
  trust: string[]; heroCap: string; heroCapBold: string;
  worksWith: string; platforms: { n: string; tag: string; on: boolean }[];
  bizEyebrow: string; bizA: string; bizB: string; bizBody: string; bizList: string[]; bizCta: string; bizToastT: string; bizToastM: string;
  famEyebrow: string; famA: string; famB: string; famBody: string; famList: string[]; famCta: string; famToastT: string; famToastM: string;
  orbEyebrow: string; orbA: string; orbB: string; orbBody: string; roles: string[]; engineLbl: string;
  engEyebrow: string; engA: string; engB: string; engSub: string; steps: Step[];
  prEyebrow: string; prA: string; prB: string; monthly: string; yearly: string; perMo: string; perYr: string; popular: string; custom: string; groupBiz: string; groupFam: string; bizPlans: Plan[]; famPlans: Plan[]; priceNote: string;
  faqEyebrow: string; faqTitle: string;
  neverEyebrow: string; neverA: string; neverB: string; neverItems: { h: string; p: string }[];
  finalA: string; finalB: string; finalC: string; finalD: string; finalBody: string; ctaBiz: string; ctaFam: string;
  // dashboard chrome labels
  dOverview: string; dActionQueue: string; dToReview: string; dProtected: string; dSignals: string; dGuardians: string;
};

const EN: Copy = {
  heroBiz: { eyebrow: "Social account firewall", l1: "Stop the harm", l2: "before it reaches you.", lead: "Tamanor reads every comment and message, scores the risk with AI, auto-hides what's clearly harmful, and routes the grey areas to your team — every action fully audited.", cta: "Deploy free →" },
  heroFam: { eyebrow: "Family safety net", l1: "Shield your family", l2: "from what hides online.", lead: "Tamanor warns you early when risky contact or harmful content reaches your family, keeps every signal private and guardian-controlled — protection, never surveillance.", cta: "Protect my family →" },
  oneEngine: "One engine ·", twoProducts: "two products", pickWorld: "· pick your world", secondary: "See the dashboard",
  trust: ["No scraping", "Official OAuth only", "Humans decide"], heroCap: "who matter — a human is always in control.", heroCapBold: "teams and families",
  worksWith: "Works with",
  platforms: [{ n: "Facebook Page", tag: "comments · auto-hide", on: true }, { n: "Instagram", tag: "comments", on: true }, { n: "YouTube", tag: "read-only", on: true }, { n: "Google Business", tag: "reviews", on: true }, { n: "LinkedIn", tag: "soon", on: false }, { n: "TikTok", tag: "soon", on: false }],
  bizEyebrow: "Tamanor for Business", bizA: "Your comment sections,", bizB: "on autopilot.", bizBody: "Every comment and DM across your channels runs the firewall: spam and scams gone instantly, harassment hidden at high confidence, and only the genuine grey areas reach your team — with a receipt for every action.", bizList: ["Auto-hide clearly harmful comments at high confidence", "Action queue for the grey areas, with approve / reject", "Reputation & actor-risk on repeat offenders", "Full audit log — no silent moderation, ever"], bizCta: "Explore Business →", bizToastT: "3 items need review", bizToastM: "2 harassment · 1 spam wave",
  famEyebrow: "Tamanor for Families", famA: "A safety net for your family —", famB: "not a spy in their pocket.", famBody: "Guardians get early warning when risky contact or harmful content reaches the people they care for. Consent-first, age-appropriate, and private by design: Tamanor flags the danger — it never hands you their diary.", famList: ["Early warning on grooming, scams & harmful content", "Guardians & consent-first onboarding", "Age-appropriate profiles, private by design", "You stay in control — nothing hidden from you"], famCta: "Explore Family →", famToastT: "Sofia is protected", famToastM: "Guardian: you · consent active",
  orbEyebrow: "One shield, everyone under it", orbA: "Protection that reaches", orbB: "every person", orbBody: "From the brand manager watching a comment storm to the grandparent worried about a grandchild online — the same engine has their back.", roles: ["Marketing", "Support", "Brand owner", "Teen", "Parent", "Grandparent"], engineLbl: "Tamanor engine",
  engEyebrow: "The engine underneath", engA: "Same pipeline.", engB: "Two worlds.", engSub: "A brand's comment section or a child's inbox — every item runs the identical four stages before anything is acted on.", steps: [{ name: "Read", body: "Official platform APIs only. Never scraping, never passwords." }, { name: "Analyze", body: "AI scores spam, scams, harassment and harm." }, { name: "Reputation", body: "Sentiment and topics build a living picture." }, { name: "Actor risk", body: "Only repeated risky behavior flags a person." }],
  prEyebrow: "Simple pricing", prA: "Start free.", prB: "Scale when ready.", monthly: "Monthly", yearly: "Yearly · 2 months free", perMo: "/mo", perYr: "/yr", popular: "Popular", custom: "Custom", groupBiz: "Tamanor for Business", groupFam: "Tamanor for Families",
  bizPlans: [{ name: "Starter", tagline: "For a single brand getting its comments under control.", cta: "Start free", features: ["1 brand · 2 accounts", "AI firewall + auto-hide", "Audit log"] }, { name: "Growth", tagline: "For growing teams across several channels.", cta: "Start free", features: ["3 brands · 10 accounts", "Actor-risk + reputation", "Team roles"] }, { name: "Business", tagline: "For agencies managing many clients at scale.", cta: "Start free", features: ["Unlimited brands", "Priority sync", "SSO & audit export"] }, { name: "Enterprise", tagline: "Custom limits, DPA and dedicated support.", cta: "Contact sales", features: ["Custom SLAs", "Dedicated support", "Security review"] }],
  famPlans: [{ name: "Family", tagline: "Calm protection for one child.", cta: "Start free", features: ["1 profile", "Guardians & consent", "Safety signals"] }, { name: "Family Plus", tagline: "For the whole family, together.", cta: "Start free", features: ["Up to 5 profiles", "Advanced guardian controls", "Priority signals"] }, { name: "Family Pro", tagline: "For big or blended households.", cta: "Start free", features: ["Unlimited profiles", "All guardian controls", "Guardian roles"] }, { name: "Custom", tagline: "Schools, clubs and larger setups.", cta: "Contact us", features: ["Custom setup", "GDPR guidance", "Priority support"] }],
  priceNote: "Business prices mirror the current catalogue · yearly = 2 months free.",
  faqEyebrow: "FAQ", faqTitle: "Good questions, straight answers.",
  neverEyebrow: "Non-negotiable", neverA: "What Tamanor", neverB: "never", neverItems: [{ h: "Never scrapes", p: "Every connector uses a platform's official, sanctioned API. No scraping, anywhere, ever." }, { h: "Never asks for passwords", p: "Official OAuth only. We never request or store login credentials for any account." }, { h: "Never hides in silence", p: "Every automated action is audited and reversible. Sensitive cases wait for a human." }],
  finalA: "Protect what you've", finalB: "built", finalC: "Protect who you", finalD: "love", finalBody: "One account, one login. Choose the world you're protecting — start free, no card.", ctaBiz: "Start with Business", ctaFam: "Start with Family",
  dOverview: "Overview", dActionQueue: "Action queue", dToReview: "To review", dProtected: "Protected", dSignals: "Recent signals", dGuardians: "Guardians",
};

const SK: Copy = {
  heroBiz: { eyebrow: "Firewall pre sociálne účty", l1: "Zastavte škodu", l2: "skôr než sa k vám dostane.", lead: "Tamanor prečíta každý komentár a správu, ohodnotí riziko pomocou AI, automaticky skryje jasne škodlivé a nejasné prípady pošle vášmu tímu — každá akcia je plne auditovaná.", cta: "Nasadiť zdarma →" },
  heroFam: { eyebrow: "Bezpečnostná sieť pre rodinu", l1: "Ochráňte svoju rodinu", l2: "pred tým, čo číha online.", lead: "Tamanor vás včas varuje, keď rizikový kontakt alebo škodlivý obsah dosiahne vašu rodinu, a každý signál drží súkromný a pod kontrolou opatrovníka — ochrana, nikdy nie sledovanie.", cta: "Ochrániť moju rodinu →" },
  oneEngine: "Jeden engine ·", twoProducts: "dva produkty", pickWorld: "· vyber si svet", secondary: "Pozri dashboard",
  trust: ["Žiadne scrapovanie", "Len oficiálny OAuth", "Rozhodujú ľudia"], heroCap: ", na ktorých záleží — vždy rozhoduje človek.", heroCapBold: "tímov a rodín",
  worksWith: "Funguje s",
  platforms: [{ n: "Facebook Page", tag: "komentáre · auto-skrytie", on: true }, { n: "Instagram", tag: "komentáre", on: true }, { n: "YouTube", tag: "len na čítanie", on: true }, { n: "Google Business", tag: "recenzie", on: true }, { n: "LinkedIn", tag: "čoskoro", on: false }, { n: "TikTok", tag: "čoskoro", on: false }],
  bizEyebrow: "Tamanor pre firmy", bizA: "Vaše komentáre,", bizB: "na autopilote.", bizBody: "Každý komentár a DM naprieč vašimi kanálmi prejde firewallom: spam a podvody zmiznú okamžite, obťažovanie sa skryje pri vysokej istote a k vášmu tímu sa dostanú len skutočne nejasné prípady — s dokladom o každej akcii.", bizList: ["Automaticky skryje jasne škodlivé komentáre pri vysokej istote", "Fronta akcií pre sivé zóny, so schválením / zamietnutím", "Reputácia a riziko aktéra pri opakovaných porušovateľoch", "Kompletný audit log — nikdy žiadna tichá moderácia"], bizCta: "Objaviť Business →", bizToastT: "3 položky na kontrolu", bizToastM: "2 obťažovania · 1 spam vlna",
  famEyebrow: "Tamanor pre rodiny", famA: "Bezpečnostná sieť pre vašu rodinu —", famB: "nie špión vo vrecku.", famBody: "Opatrovníci dostanú včasné varovanie, keď rizikový kontakt alebo škodlivý obsah dosiahne ich blízkych. Súhlas na prvom mieste, primerané veku a súkromné od návrhu: Tamanor označí nebezpečenstvo — nikdy vám nedá ich denník.", famList: ["Včasné varovanie pred groomingom, podvodmi a škodlivým obsahom", "Opatrovníci a onboarding so súhlasom na prvom mieste", "Profily primerané veku, súkromné od návrhu", "Vy máte kontrolu — nič nie je pred vami skryté"], famCta: "Objaviť Family →", famToastT: "Sofia je chránená", famToastM: "Opatrovník: vy · súhlas aktívny",
  orbEyebrow: "Jeden štít, všetci pod ním", orbA: "Ochrana, ktorá dosiahne", orbB: "každého človeka", orbBody: "Od brand manažéra, čo sleduje búrku komentárov, po starého rodiča, čo sa bojí o vnúča online — rovnaký engine kryje chrbát všetkým.", roles: ["Marketing", "Podpora", "Majiteľ značky", "Tínedžer", "Rodič", "Starý rodič"], engineLbl: "Tamanor engine",
  engEyebrow: "Engine v pozadí", engA: "Rovnaká pipeline.", engB: "Dva svety.", engSub: "Komentáre značky alebo detská schránka — každá položka prejde rovnakými štyrmi fázami, než sa čokoľvek vykoná.", steps: [{ name: "Čítanie", body: "Len oficiálne API platforiem. Nikdy scrapovanie, nikdy heslá." }, { name: "Analýza", body: "AI ohodnotí spam, podvody, obťažovanie a škodlivosť." }, { name: "Reputácia", body: "Sentiment a témy vytvárajú živý obraz." }, { name: "Riziko aktéra", body: "Osobu označí len opakované rizikové správanie." }],
  prEyebrow: "Jednoduchý cenník", prA: "Začni zdarma.", prB: "Rozšír, keď budeš pripravený.", monthly: "Mesačne", yearly: "Ročne · 2 mesiace zdarma", perMo: "/mes", perYr: "/rok", popular: "Populárne", custom: "Na mieru", groupBiz: "Tamanor pre firmy", groupFam: "Tamanor pre rodiny",
  bizPlans: [{ name: "Starter", tagline: "Pre jednu značku, čo si dáva komentáre do poriadku.", cta: "Začať zdarma", features: ["1 značka · 2 účty", "AI firewall + auto-skrytie", "Audit log"] }, { name: "Growth", tagline: "Pre rastúce tímy naprieč viacerými kanálmi.", cta: "Začať zdarma", features: ["3 značky · 10 účtov", "Riziko aktéra + reputácia", "Tímové roly"] }, { name: "Business", tagline: "Pre agentúry spravujúce mnoho klientov vo veľkom.", cta: "Začať zdarma", features: ["Neobmedzené značky", "Prioritná synchronizácia", "SSO a export auditu"] }, { name: "Enterprise", tagline: "Vlastné limity, DPA a dedikovaná podpora.", cta: "Kontaktovať obchod", features: ["Vlastné SLA", "Dedikovaná podpora", "Bezpečnostný audit"] }],
  famPlans: [{ name: "Family", tagline: "Pokojná ochrana pre jedno dieťa.", cta: "Začať zdarma", features: ["1 profil", "Opatrovníci a súhlas", "Bezpečnostné signály"] }, { name: "Family Plus", tagline: "Pre celú rodinu, spolu.", cta: "Začať zdarma", features: ["Až 5 profilov", "Pokročilé ovládanie", "Prioritné signály"] }, { name: "Family Pro", tagline: "Pre veľké alebo zmiešané domácnosti.", cta: "Začať zdarma", features: ["Neobmedzené profily", "Všetky ovládania", "Roly opatrovníkov"] }, { name: "Custom", tagline: "Školy, kluby a väčšie nastavenia.", cta: "Kontaktujte nás", features: ["Vlastné nastavenie", "Pomoc s GDPR", "Prioritná podpora"] }],
  priceNote: "Firemné ceny zodpovedajú aktuálnemu katalógu · ročne = 2 mesiace zdarma.",
  faqEyebrow: "FAQ", faqTitle: "Dobré otázky, jasné odpovede.",
  neverEyebrow: "Neoddiskutovateľné", neverA: "Čo Tamanor", neverB: "nikdy", neverItems: [{ h: "Nikdy nescrapuje", p: "Každý konektor používa oficiálne, schválené API platformy. Žiadne scrapovanie, nikde, nikdy." }, { h: "Nikdy nežiada heslá", p: "Len oficiálny OAuth. Nikdy nežiadame ani neukladáme prihlasovacie údaje k žiadnemu účtu." }, { h: "Nikdy neskrýva v tichosti", p: "Každá automatická akcia je auditovaná a vratná. Citlivé prípady čakajú na človeka." }],
  finalA: "Ochráňte, čo ste", finalB: "vybudovali", finalC: "Ochráňte tých, ktorých", finalD: "milujete", finalBody: "Jeden účet, jedno prihlásenie. Vyberte si svet, ktorý chránite — začnite zdarma, bez karty.", ctaBiz: "Začať s Business", ctaFam: "Začať s Family",
  dOverview: "Prehľad", dActionQueue: "Fronta akcií", dToReview: "Na kontrolu", dProtected: "Chránené", dSignals: "Nedávne signály", dGuardians: "Opatrovníci",
};

const DE: Copy = {
  heroBiz: { eyebrow: "Firewall für Social-Media-Konten", l1: "Stoppe den Schaden", l2: "bevor er dich erreicht.", lead: "Tamanor liest jeden Kommentar und jede Nachricht, bewertet das Risiko mit KI, blendet eindeutig Schädliches automatisch aus und leitet die Grauzonen an dein Team weiter — jede Aktion vollständig auditiert.", cta: "Kostenlos loslegen →" },
  heroFam: { eyebrow: "Sicherheitsnetz für Familien", l1: "Beschütze deine Familie", l2: "vor dem, was online lauert.", lead: "Tamanor warnt dich früh, wenn riskanter Kontakt oder schädliche Inhalte deine Familie erreichen, und hält jedes Signal privat und unter Kontrolle der Erziehungsberechtigten — Schutz, niemals Überwachung.", cta: "Meine Familie schützen →" },
  oneEngine: "Eine Engine ·", twoProducts: "zwei Produkte", pickWorld: "· wähle deine Welt", secondary: "Dashboard ansehen",
  trust: ["Kein Scraping", "Nur offizielles OAuth", "Menschen entscheiden"], heroCap: ", die zählen — ein Mensch behält immer die Kontrolle.", heroCapBold: "Teams und Familien",
  worksWith: "Funktioniert mit",
  platforms: [{ n: "Facebook Page", tag: "Kommentare · Auto-Ausblenden", on: true }, { n: "Instagram", tag: "Kommentare", on: true }, { n: "YouTube", tag: "nur lesen", on: true }, { n: "Google Business", tag: "Bewertungen", on: true }, { n: "LinkedIn", tag: "bald", on: false }, { n: "TikTok", tag: "bald", on: false }],
  bizEyebrow: "Tamanor für Unternehmen", bizA: "Deine Kommentarbereiche,", bizB: "auf Autopilot.", bizBody: "Jeder Kommentar und jede DM über deine Kanäle läuft durch die Firewall: Spam und Betrug sofort weg, Belästigung bei hoher Sicherheit ausgeblendet, und nur die echten Grauzonen erreichen dein Team — mit einem Beleg für jede Aktion.", bizList: ["Blendet eindeutig schädliche Kommentare bei hoher Sicherheit aus", "Aktions-Warteschlange für Grauzonen, mit Freigabe / Ablehnung", "Reputation & Akteur-Risiko bei Wiederholungstätern", "Vollständiges Audit-Log — niemals stille Moderation"], bizCta: "Business entdecken →", bizToastT: "3 Elemente zu prüfen", bizToastM: "2 Belästigungen · 1 Spam-Welle",
  famEyebrow: "Tamanor für Familien", famA: "Ein Schutznetz für deine Familie —", famB: "kein Spion in der Tasche.", famBody: "Erziehungsberechtigte werden früh gewarnt, wenn riskanter Kontakt oder schädliche Inhalte ihre Schützlinge erreichen. Einwilligung zuerst, altersgerecht und privat by design: Tamanor markiert die Gefahr — übergibt dir aber niemals ihr Tagebuch.", famList: ["Frühwarnung bei Grooming, Betrug & schädlichen Inhalten", "Erziehungsberechtigte & Einwilligung-zuerst-Onboarding", "Altersgerechte Profile, privat by design", "Du behältst die Kontrolle — nichts wird vor dir verborgen"], famCta: "Family entdecken →", famToastT: "Sofia ist geschützt", famToastM: "Erziehungsberechtigte: du · Einwilligung aktiv",
  orbEyebrow: "Ein Schild, alle darunter", orbA: "Schutz, der", orbB: "jeden Menschen", orbBody: "Vom Brand-Manager, der einen Kommentarsturm beobachtet, bis zum Großelternteil, das sich um ein Enkelkind sorgt — dieselbe Engine schützt sie alle.", roles: ["Marketing", "Support", "Markeninhaber", "Teenager", "Elternteil", "Großeltern"], engineLbl: "Tamanor Engine",
  engEyebrow: "Die Engine dahinter", engA: "Dieselbe Pipeline.", engB: "Zwei Welten.", engSub: "Der Kommentarbereich einer Marke oder das Postfach eines Kindes — jedes Element durchläuft dieselben vier Phasen, bevor irgendetwas geschieht.", steps: [{ name: "Lesen", body: "Nur offizielle Plattform-APIs. Kein Scraping, keine Passwörter." }, { name: "Analyse", body: "KI bewertet Spam, Betrug, Belästigung und Schaden." }, { name: "Reputation", body: "Stimmung und Themen ergeben ein lebendiges Bild." }, { name: "Akteur-Risiko", body: "Nur wiederholt riskantes Verhalten markiert eine Person." }],
  prEyebrow: "Einfache Preise", prA: "Kostenlos starten.", prB: "Skaliere, wenn du bereit bist.", monthly: "Monatlich", yearly: "Jährlich · 2 Monate gratis", perMo: "/Mon", perYr: "/Jahr", popular: "Beliebt", custom: "Individuell", groupBiz: "Tamanor für Unternehmen", groupFam: "Tamanor für Familien",
  bizPlans: [{ name: "Starter", tagline: "Für eine einzelne Marke, die ihre Kommentare in den Griff bekommt.", cta: "Kostenlos starten", features: ["1 Marke · 2 Konten", "KI-Firewall + Auto-Ausblenden", "Audit-Log"] }, { name: "Growth", tagline: "Für wachsende Teams über mehrere Kanäle.", cta: "Kostenlos starten", features: ["3 Marken · 10 Konten", "Akteur-Risiko + Reputation", "Team-Rollen"] }, { name: "Business", tagline: "Für Agenturen, die viele Kunden im großen Maßstab verwalten.", cta: "Kostenlos starten", features: ["Unbegrenzte Marken", "Prioritäts-Sync", "SSO & Audit-Export"] }, { name: "Enterprise", tagline: "Individuelle Limits, AVV und dedizierter Support.", cta: "Vertrieb kontaktieren", features: ["Individuelle SLAs", "Dedizierter Support", "Sicherheitsprüfung"] }],
  famPlans: [{ name: "Family", tagline: "Ruhiger Schutz für ein Kind.", cta: "Kostenlos starten", features: ["1 Profil", "Erziehungsberechtigte & Einwilligung", "Sicherheitssignale"] }, { name: "Family Plus", tagline: "Für die ganze Familie, zusammen.", cta: "Kostenlos starten", features: ["Bis zu 5 Profile", "Erweiterte Kontrollen", "Prioritäts-Signale"] }, { name: "Family Pro", tagline: "Für große oder Patchwork-Haushalte.", cta: "Kostenlos starten", features: ["Unbegrenzte Profile", "Alle Kontrollen", "Rollen für Erziehungsberechtigte"] }, { name: "Custom", tagline: "Schulen, Vereine und größere Setups.", cta: "Kontaktiere uns", features: ["Individuelles Setup", "DSGVO-Hilfe", "Prioritäts-Support"] }],
  priceNote: "Business-Preise entsprechen dem aktuellen Katalog · jährlich = 2 Monate gratis.",
  faqEyebrow: "FAQ", faqTitle: "Gute Fragen, klare Antworten.",
  neverEyebrow: "Nicht verhandelbar", neverA: "Was Tamanor", neverB: "niemals", neverItems: [{ h: "Scrapet niemals", p: "Jeder Connector nutzt die offizielle, freigegebene API der Plattform. Kein Scraping, nirgends, niemals." }, { h: "Fragt nie nach Passwörtern", p: "Nur offizielles OAuth. Wir fordern oder speichern niemals Anmeldedaten für ein Konto." }, { h: "Verbirgt nie im Stillen", p: "Jede automatische Aktion wird auditiert und ist umkehrbar. Sensible Fälle warten auf einen Menschen." }],
  finalA: "Schütze, was du", finalB: "aufgebaut", finalC: "Schütze, die du", finalD: "liebst", finalBody: "Ein Konto, ein Login. Wähle die Welt, die du schützt — kostenlos starten, ohne Karte.", ctaBiz: "Mit Business starten", ctaFam: "Mit Family starten",
  dOverview: "Übersicht", dActionQueue: "Aktions-Warteschlange", dToReview: "Zu prüfen", dProtected: "Geschützt", dSignals: "Aktuelle Signale", dGuardians: "Erziehungsberechtigte",
};

const COPY: Record<string, Copy> = { en: EN, sk: SK, de: DE };

export type LandingV2Props = { copy?: unknown; logIn?: string; locale?: Locale };

/* ---------- small helpers ---------- */
function Face({ src, size = 34 }: { src: string; size?: number }) {
  return <img src={src} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0, background: "#e9eef6" }} />;
}
function Check({ c }: { c: string }) {
  return (
    <span aria-hidden style={{ flexShrink: 0, marginTop: 1, height: 20, width: 20, borderRadius: 6, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${c} 22%, transparent)`, color: c }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
    </span>
  );
}

/* ---------- page ---------- */
export function LandingV2({ locale = "en" }: LandingV2Props) {
  const t = COPY[locale] ?? EN;
  const [mode, setMode] = useState<"business" | "family">("business");
  const [yearly, setYearly] = useState(false);
  const acc = mode === "business" ? BIZ : FAM;
  const h = mode === "business" ? t.heroBiz : t.heroFam;

  const eyebrow: React.CSSProperties = { margin: 0, fontFamily: mono, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.16em", color: acc.deep };
  const fmtPrice = (v: number) => (Number.isInteger(v) ? `€${v}` : `€${v.toFixed(2).replace(".", ",")}`);
  const priceFor = (v: number | null) => (v == null ? t.custom : fmtPrice(yearly ? Math.round(v * 10 * 100) / 100 : v));
  const per = yearly ? t.perYr : t.perMo;

  const roleImgs = [IMG.marketing, IMG.support, IMG.owner, IMG.teen, IMG.parent, IMG.grand];
  const orbitPos = [{ top: "7%", left: "50%" }, { top: "29%", left: "90%" }, { top: "71%", left: "90%" }, { top: "93%", left: "50%" }, { top: "71%", left: "10%" }, { top: "29%", left: "10%" }];

  const heroImgs = [IMG.marketing, IMG.owner, IMG.support, IMG.teen, IMG.grand];

  return (
    <div className="tmr-l2" style={{ background: C.bg, color: C.ink, fontFamily: sans, overflow: "hidden" }}>
      <style dangerouslySetInnerHTML={{ __html: KF }} />
      <SiteHeader locale={locale} />

      {/* ===== HERO ===== */}
      <section style={{ position: "relative", padding: "30px 0 70px", overflow: "hidden" }}>
        {/* soft blobs */}
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
          <div style={{ position: "absolute", width: "44vw", height: "44vw", top: "-16vw", left: "-8vw", borderRadius: "50%", filter: "blur(80px)", opacity: 0.5, background: `radial-gradient(circle, color-mix(in srgb, ${acc.a} 26%, transparent), transparent 62%)`, transition: "background .5s" }} />
          <div style={{ position: "absolute", width: "36vw", height: "36vw", top: "-6vw", right: "-8vw", borderRadius: "50%", filter: "blur(80px)", opacity: 0.5, background: `radial-gradient(circle, color-mix(in srgb, ${acc.a2} 24%, transparent), transparent 60%)`, transition: "background .5s" }} />
        </div>

        <div style={{ position: "relative", zIndex: 1, maxWidth: 1240, margin: "0 auto", padding: "0 26px" }}>
          {/* product toggle */}
          <div role="tablist" aria-label="Product" style={{ display: "inline-flex", gap: 4, padding: 5, borderRadius: 999, background: "#fff", border: `1px solid ${C.line2}`, boxShadow: "0 2px 10px rgba(15,23,42,.05)" }}>
            {(["business", "family"] as const).map((m) => {
              const on = mode === m;
              const mc = m === "business" ? BIZ : FAM;
              return (
                <button key={m} role="tab" aria-selected={on} onClick={() => setMode(m)} style={{ border: 0, cursor: "pointer", fontFamily: mono, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600, color: on ? "#fff" : C.dim, padding: "9px 20px", borderRadius: 999, background: on ? `linear-gradient(180deg, ${mc.a2}, ${mc.a})` : "transparent", boxShadow: on ? `0 6px 18px color-mix(in srgb, ${mc.a} 34%, transparent)` : "none", transition: ".25s" }}>
                  {m === "business" ? (locale === "sk" ? "Pre firmy" : locale === "de" ? "Für Unternehmen" : "For Business") : (locale === "sk" ? "Pre rodiny" : locale === "de" ? "Für Familien" : "For Families")}
                </button>
              );
            })}
          </div>

          <div className="tmr-cols" style={{ marginTop: 30, display: "grid", gridTemplateColumns: "1fr 1.08fr", gap: 48, alignItems: "center" }}>
            <div>
              <p style={{ ...eyebrow, transition: "color .4s" }}>{h.eyebrow}</p>
              <h1 style={{ margin: "22px 0 0", fontSize: "clamp(38px,5.6vw,64px)", lineHeight: 1.0, fontWeight: 800, letterSpacing: "-0.035em", fontFamily: disp }}>
                {h.l1}<br /><span style={{ background: `linear-gradient(92deg, ${acc.deep}, ${acc.a2})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{h.l2}</span>
              </h1>
              <p style={{ margin: "24px 0 0", maxWidth: "46ch", fontSize: 16.5, lineHeight: 1.72, color: C.dim }}>{h.lead}</p>
              <div style={{ marginTop: 28, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Link href="/register" style={{ display: "inline-flex", alignItems: "center", fontFamily: mono, fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", padding: "15px 26px", borderRadius: 11, color: "#fff", background: `linear-gradient(180deg, ${acc.a2}, ${acc.a})`, boxShadow: `0 8px 22px color-mix(in srgb, ${acc.a} 34%, transparent)` }}>{h.cta}</Link>
                <a href="#biz" style={{ display: "inline-flex", alignItems: "center", fontFamily: mono, fontSize: 12.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", padding: "15px 26px", borderRadius: 11, color: C.ink, border: `1px solid ${C.line2}`, background: "#fff" }}>{t.secondary}</a>
              </div>
              <div style={{ marginTop: 24, display: "flex", gap: 20, flexWrap: "wrap", fontFamily: mono, fontSize: 11, color: C.faint }}>
                {t.trust.map((x, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <i style={{ height: 6, width: 6, borderRadius: "50%", background: acc.a, boxShadow: `0 0 7px color-mix(in srgb, ${acc.a} 60%, transparent)` }} />
                    <b style={{ color: C.dim, fontWeight: 600 }}>{x}</b>
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 13 }}>
                <div style={{ display: "flex" }}>
                  {heroImgs.map((src, i) => (
                    <span key={i} style={{ height: 38, width: 38, borderRadius: "50%", overflow: "hidden", border: "2.5px solid #fff", marginLeft: i ? -11 : 0, boxShadow: "0 4px 10px rgba(15,23,42,.14)" }}><Face src={src} size={38} /></span>
                  ))}
                </div>
                <p style={{ margin: 0, fontSize: 12.5, color: C.dim, maxWidth: "26ch", lineHeight: 1.5 }}>{locale === "sk" ? "Vytvorené na ochranu " : locale === "de" ? "Entwickelt zum Schutz der " : "Built to protect the "}<b style={{ color: C.ink }}>{t.heroCapBold}</b>{t.heroCap}</p>
              </div>
            </div>

            {/* product window */}
            <div style={{ position: "relative" }}>
              <div aria-hidden style={{ position: "absolute", left: 8, right: 8, height: 74, zIndex: 4, borderRadius: 16, background: `linear-gradient(180deg, transparent, color-mix(in srgb, ${acc.a} 18%, transparent), transparent)`, mixBlendMode: "multiply", animation: "tmr-scan 3.8s ease-in-out infinite", top: 0 }} className="tmr-anim-scan" />
              <span style={{ position: "absolute", zIndex: 6, bottom: 14, left: 14, display: "inline-flex", alignItems: "center", gap: 7, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 999, padding: "5px 11px", fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: acc.deep, boxShadow: "0 8px 20px rgba(15,23,42,.12)" }}>
                <i style={{ height: 6, width: 6, borderRadius: "50%", background: acc.a, boxShadow: `0 0 8px ${acc.a}`, animation: "tmr-lp 1.5s infinite" }} className="tmr-anim-lp" /> Live · scanning
              </span>
              <DashWindow mode={mode} acc={acc} t={t} />
            </div>
          </div>
        </div>
      </section>

      {/* ===== PLATFORM STRIP ===== */}
      <section id="platforms" style={{ borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, background: "#fff", padding: "24px 0" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 26px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginRight: 4 }}>{t.worksWith}</span>
          {t.platforms.map((p) => (
            <span key={p.n} style={{ display: "inline-flex", alignItems: "center", gap: 9, border: `1px solid ${C.line}`, borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 600 }}>
              <span style={{ height: 7, width: 7, borderRadius: "50%", background: p.on ? C.green : C.amber }} />
              {p.n} <small style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint, fontWeight: 500 }}>{p.tag}</small>
            </span>
          ))}
        </div>
      </section>

      {/* ===== BUSINESS SHOWCASE ===== */}
      <Showcase id="biz" reverse={false} acc={BIZ}
        eyebrow={t.bizEyebrow} a={t.bizA} b={t.bizB} body={t.bizBody} list={t.bizList} cta={t.bizCta}
        toastT={t.bizToastT} toastM={t.bizToastM} toastIcon="⚑"
        window={<DashWindow mode="business" acc={BIZ} t={t} big />} />

      {/* ===== FAMILY SHOWCASE ===== */}
      <Showcase id="fam" reverse={true} acc={FAM} bg={`linear-gradient(180deg,#fff,#f2fbf7)`}
        eyebrow={t.famEyebrow} a={t.famA} b={t.famB} body={t.famBody} list={t.famList} cta={t.famCta}
        toastT={t.famToastT} toastM={t.famToastM} toastIcon="🛡"
        window={<DashWindow mode="family" acc={FAM} t={t} big />} />

      {/* ===== PROTECTION NETWORK ===== */}
      <section style={{ position: "relative", padding: "94px 0", background: "linear-gradient(180deg,#fff,#f3f7fe)", borderTop: `1px solid ${C.line}`, overflow: "hidden", textAlign: "center" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 26px" }}>
          <div style={{ maxWidth: "56ch", margin: "0 auto 46px" }}>
            <p style={{ ...eyebrow, color: C.faint, display: "inline-flex", alignItems: "center", gap: 11 }}>{t.orbEyebrow}</p>
            <h2 style={{ margin: "12px 0 0", fontSize: "clamp(28px,3.8vw,42px)", fontWeight: 800, letterSpacing: "-0.035em", fontFamily: disp }}>{t.orbA} <span style={{ fontStyle: "italic", background: `linear-gradient(90deg, ${BIZ.a}, ${FAM.a})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{t.orbB}</span>{locale === "en" ? " who matters." : ""}</h2>
            <p style={{ margin: "16px auto 0", color: C.dim, fontSize: 16 }}>{t.orbBody}</p>
          </div>
          <div style={{ position: "relative", width: "min(470px,100%)", margin: "0 auto", aspectRatio: "1 / 1" }}>
            {["3%", "21%", "39%"].map((inset, i) => (
              <span key={inset} style={{ position: "absolute", inset, borderRadius: "50%", border: `1px ${i === 1 ? "dashed" : "solid"} ${C.line}` }} />
            ))}
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", display: "grid", placeItems: "center" }}>
              <ShieldEmblem size={92} />
              <span style={{ marginTop: 6, fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint }}>{t.engineLbl}</span>
            </div>
            {orbitPos.map((pos, i) => (
              <div key={i} style={{ position: "absolute", top: pos.top, left: pos.left, transform: "translate(-50%,-50%)", textAlign: "center" }}>
                <span style={{ display: "block", height: 60, width: 60, borderRadius: "50%", overflow: "hidden", border: "3px solid #fff", boxShadow: "0 10px 24px rgba(15,23,42,.16)", animation: "tmr-bob 6s ease-in-out infinite" }} className="tmr-anim-bob"><Face src={roleImgs[i] ?? IMG.owner} size={60} /></span>
                <em style={{ display: "block", marginTop: 6, fontSize: 11, fontStyle: "normal", fontWeight: 600, color: C.dim }}>{t.roles[i] ?? ""}</em>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== ENGINE ===== */}
      <section id="engine" style={{ borderTop: `1px solid ${C.line}`, padding: "84px 0", background: "#fff" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 26px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap", marginBottom: 34 }}>
            <div>
              <p style={{ ...eyebrow, color: C.faint }}>{t.engEyebrow}</p>
              <h2 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3.4vw,38px)", fontWeight: 800, letterSpacing: "-0.035em", fontFamily: disp }}>{t.engA} <span style={{ fontStyle: "italic", background: `linear-gradient(90deg, ${BIZ.a}, ${FAM.a})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{t.engB}</span></h2>
            </div>
            <p style={{ maxWidth: "38ch", color: C.dim, fontSize: 14, lineHeight: 1.7 }}>{t.engSub}</p>
          </div>
          <div className="tmr-cards" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            {t.steps.map((s, i) => (
              <div key={s.name} style={{ position: "relative", border: `1px solid ${C.line}`, borderRadius: 14, padding: 20, background: "#fbfcfe" }}>
                <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: C.faint }}>{(locale === "sk" ? "Fáza 0" : "Phase 0") + (i + 1)}</div>
                <h3 style={{ margin: "11px 0 0", fontSize: 17, fontWeight: 700, fontFamily: disp }}>{s.name}</h3>
                <p style={{ margin: "8px 0 0", fontSize: 12.5, color: C.dim, lineHeight: 1.6 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PRICING ===== */}
      <section id="pricing" style={{ padding: "92px 0", borderTop: `1px solid ${C.line}`, background: "linear-gradient(180deg,#fff,#f4f8fe)" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 26px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 22 }}>
            <div>
              <p style={{ ...eyebrow, color: C.faint }}>{t.prEyebrow}</p>
              <h2 style={{ margin: "12px 0 0", fontSize: "clamp(26px,3.6vw,40px)", fontWeight: 800, letterSpacing: "-0.035em", fontFamily: disp }}>{t.prA} <span style={{ fontStyle: "italic", background: `linear-gradient(90deg, ${BIZ.a}, ${FAM.a})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{t.prB}</span></h2>
            </div>
            <div style={{ display: "inline-flex", border: `1px solid ${C.line2}`, borderRadius: 999, padding: 4, background: "#fff" }}>
              {[{ y: false, l: t.monthly }, { y: true, l: t.yearly }].map((o) => (
                <button key={o.l} onClick={() => setYearly(o.y)} style={{ border: 0, cursor: "pointer", fontFamily: mono, fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600, color: o.y === yearly ? "#fff" : C.dim, background: o.y === yearly ? BIZ.a : "transparent", padding: "9px 16px", borderRadius: 999 }}>{o.l}</button>
              ))}
            </div>
          </div>

          <PriceGroup title={t.groupBiz} plans={t.bizPlans} prices={BIZ_PRICES} acc={BIZ} per={per} custom={t.custom} popular={t.popular} priceFor={priceFor} />
          <PriceGroup title={t.groupFam} plans={t.famPlans} prices={FAM_PRICES} acc={FAM} per={per} custom={t.custom} popular={t.popular} priceFor={priceFor} />

          <p style={{ textAlign: "center", margin: "22px 0 0", fontSize: 11, color: C.faint, fontFamily: mono }}>{t.priceNote}</p>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section style={{ padding: "84px 0", borderTop: `1px solid ${C.line}`, background: "#fff" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 26px" }}>
          <div style={{ maxWidth: "60ch", margin: "0 auto 28px", textAlign: "center" }}>
            <p style={{ ...eyebrow, color: C.faint }}>{t.faqEyebrow}</p>
            <h2 style={{ margin: "12px 0 0", fontSize: "clamp(24px,3vw,34px)", fontWeight: 800, letterSpacing: "-0.035em", fontFamily: disp }}>{t.faqTitle}</h2>
          </div>
          <div style={{ maxWidth: 820, margin: "0 auto", borderTop: `1px solid ${C.line}` }}>
            {landingFaqs(locale).map((f, i) => (
              <details key={f.q} open={i === 0} style={{ borderBottom: `1px solid ${C.line}` }}>
                <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 0", fontSize: 15, fontWeight: 600 }}>
                  {f.q}<span className="tmr-sign" style={{ color: BIZ.a, fontSize: 18, transition: "transform .2s", flexShrink: 0 }}>+</span>
                </summary>
                <p style={{ margin: 0, padding: "0 0 18px", maxWidth: "72ch", fontSize: 14, color: C.dim, lineHeight: 1.7 }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ===== NEVER ===== */}
      <section style={{ borderTop: `1px solid ${C.line}`, background: "#0b1220", color: "#cdd7e6", padding: "66px 0" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 26px" }}>
          <div style={{ textAlign: "center", marginBottom: 34 }}>
            <p style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "#7aa2ff", fontWeight: 600 }}>{t.neverEyebrow}</p>
            <h2 style={{ margin: "12px 0 0", color: "#fff", fontSize: "clamp(24px,3vw,34px)", fontWeight: 800, letterSpacing: "-0.035em", fontFamily: disp }}>{t.neverA} <span style={{ fontStyle: "italic" }}>{t.neverB}</span>{locale === "en" ? " does." : locale === "sk" ? " nerobí." : " tut."}</h2>
          </div>
          <div className="tmr-cards" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {t.neverItems.map((n) => (
              <div key={n.h} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, padding: 22, background: "rgba(255,255,255,.03)" }}>
                <div style={{ height: 34, width: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(255,93,108,.16)", color: "#ff8a94", fontWeight: 800, marginBottom: 12 }}>✕</div>
                <h3 style={{ color: "#fff", fontSize: 17, fontWeight: 700, fontFamily: disp }}>{n.h}</h3>
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "#93a2ba", lineHeight: 1.6 }}>{n.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA ===== */}
      <section style={{ position: "relative", padding: "100px 0", textAlign: "center", overflow: "hidden", background: "radial-gradient(50rem 26rem at 50% 120%, rgba(37,99,235,.08), transparent 65%)" }}>
        <div style={{ position: "relative", zIndex: 1, maxWidth: 1240, margin: "0 auto", padding: "0 26px" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            {[IMG.teen, IMG.sofia, IMG.support, IMG.marketing, IMG.grand, IMG.jakub].map((src, i) => (
              <span key={i} style={{ height: 46, width: 46, borderRadius: "50%", overflow: "hidden", border: "3px solid #fff", marginLeft: i ? -13 : 0, boxShadow: "0 8px 20px rgba(15,23,42,.16)" }}><Face src={src} size={46} /></span>
            ))}
          </div>
          <h2 style={{ margin: "0 auto", maxWidth: "20ch", fontSize: "clamp(30px,4.6vw,52px)", lineHeight: 1.03, fontWeight: 800, letterSpacing: "-0.035em", fontFamily: disp }}>
            {t.finalA} <span style={{ fontStyle: "italic", background: `linear-gradient(90deg, ${BIZ.a2}, ${BIZ.a})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{t.finalB}</span>.<br />{t.finalC} <span style={{ fontStyle: "italic", background: `linear-gradient(90deg, ${FAM.a2}, ${FAM.a})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{t.finalD}</span>.
          </h2>
          <p style={{ margin: "20px auto 0", maxWidth: "46ch", color: C.dim, fontSize: 16 }}>{t.finalBody}</p>
          <div style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <Link href="/register" style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", padding: "15px 28px", borderRadius: 11, color: "#fff", background: `linear-gradient(180deg, ${BIZ.a2}, ${BIZ.a})`, boxShadow: `0 8px 22px color-mix(in srgb, ${BIZ.a} 34%, transparent)` }}>{t.ctaBiz}</Link>
            <Link href="/register" style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", padding: "15px 28px", borderRadius: 11, color: "#fff", background: `linear-gradient(180deg, ${FAM.a2}, ${FAM.a})`, boxShadow: `0 8px 22px color-mix(in srgb, ${FAM.a} 34%, transparent)` }}>{t.ctaFam}</Link>
          </div>
        </div>
      </section>

      <SiteFooter locale={locale} />
    </div>
  );
}

/* ---------- showcase section ---------- */
function Showcase({ id, reverse, acc, bg, eyebrow, a, b, body, list, cta, toastT, toastM, toastIcon, window }: {
  id: string; reverse: boolean; acc: typeof BIZ; bg?: string; eyebrow: string; a: string; b: string; body: string; list: string[]; cta: string; toastT: string; toastM: string; toastIcon: string; window: React.ReactNode;
}) {
  const copy = (
    <div style={reverse ? { order: 2 } as React.CSSProperties : undefined}>
      <p style={{ margin: 0, fontFamily: mono, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.16em", color: acc.deep, display: "inline-flex", alignItems: "center", gap: 11 }}>{eyebrow}</p>
      <h2 style={{ margin: "14px 0 0", fontSize: "clamp(28px,3.8vw,44px)", lineHeight: 1.06, fontWeight: 800, letterSpacing: "-0.035em", fontFamily: disp }}>{a}<br /><span style={{ color: acc.deep, fontStyle: "italic" }}>{b}</span></h2>
      <p style={{ margin: "18px 0 0", fontSize: 16, color: C.dim, lineHeight: 1.72, maxWidth: "44ch" }}>{body}</p>
      <ul style={{ margin: "24px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 13 }}>
        {list.map((x) => (
          <li key={x} style={{ display: "flex", gap: 12, fontSize: 14.5 }}><Check c={acc.a} />{x}</li>
        ))}
      </ul>
      <Link href="/register" style={{ marginTop: 28, display: "inline-flex", alignItems: "center", gap: 9, fontFamily: mono, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", padding: "14px 26px", borderRadius: 12, color: "#fff", background: `linear-gradient(180deg, ${acc.a2}, ${acc.a})` }}>{cta}</Link>
    </div>
  );
  const win = (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", zIndex: 6, top: 40, ...(reverse ? { left: -18 } : { right: -18 }), background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px", boxShadow: "0 18px 40px rgba(15,23,42,.16)", display: "flex", gap: 10, alignItems: "center", maxWidth: 240 }}>
        <span style={{ height: 30, width: 30, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", color: "#fff", background: acc.a }}>{toastIcon}</span>
        <div><div style={{ fontSize: 12, fontWeight: 700 }}>{toastT}</div><div style={{ fontSize: 10.5, color: C.faint }}>{toastM}</div></div>
      </div>
      {window}
    </div>
  );
  return (
    <section id={id} style={{ position: "relative", padding: "96px 0", overflow: "hidden", background: bg }}>
      <div className="tmr-cols" style={{ maxWidth: 1240, margin: "0 auto", padding: "0 26px", display: "grid", gridTemplateColumns: reverse ? "1.15fr 1fr" : "1fr 1.15fr", gap: 52, alignItems: "center" }}>
        {reverse ? (<>{win}{copy}</>) : (<>{copy}{win}</>)}
      </div>
    </section>
  );
}

/* ---------- dashboard window mock ---------- */
function DashWindow({ mode, acc, t, big }: { mode: "business" | "family"; acc: typeof BIZ; t: Copy; big?: boolean }) {
  const url = mode === "business" ? "app.tamanor.com/dashboard" : "app.tamanor.com/family";
  const side = mode === "business" ? "#0b1220" : "#08140f";
  const nav = mode === "business"
    ? [t.dOverview, "Accounts", "Comments", t.dActionQueue]
    : [t.dOverview, "Profiles", t.dGuardians, t.dSignals];
  return (
    <div style={{ borderRadius: 16, border: `1px solid ${C.line2}`, background: "#fff", boxShadow: "0 40px 90px rgba(15,23,42,.20)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", borderBottom: `1px solid ${C.line}`, background: "#fbfcfe" }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ height: 10, width: 10, borderRadius: "50%", background: "#e2e8f0" }} />)}
        <span style={{ marginLeft: 10, flex: 1, height: 22, borderRadius: 7, background: "#eef2f8", display: "flex", alignItems: "center", padding: "0 10px", fontFamily: mono, fontSize: 10, color: C.faint }}>🔒 {url}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "170px 1fr" }}>
        <div style={{ background: side, color: "#cdd7e6", padding: "14px 11px", display: "flex", flexDirection: "column", gap: 3, minHeight: big ? 400 : 340 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13, color: "#fff", padding: "4px 8px 10px" }}>◈ Tamanor</div>
          {nav.map((n, i) => (
            <span key={n + i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 8, fontSize: 12, fontWeight: 500, color: i === 0 ? "#fff" : "#93a2ba", background: i === 0 ? `color-mix(in srgb, ${acc.a} 22%, transparent)` : "transparent" }}>
              <span style={{ opacity: 0.85 }}>▦</span>{n}
              {((mode === "business" && i === 3) || (mode === "family" && i === 3)) ? <span style={{ marginLeft: "auto", background: C.red, color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "1px 7px" }}>{mode === "business" ? 3 : 2}</span> : null}
            </span>
          ))}
        </div>
        <div style={{ background: "#f6f9fd", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{mode === "business" ? t.dOverview : t.dOverview}</h4>
            <span style={{ height: 28, width: 28, borderRadius: "50%", overflow: "hidden" }}><Face src={IMG.marketing} size={28} /></span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {(mode === "business"
              ? [{ p: "Protection score", v: "92", c: acc.a }, { p: "Threats hidden", v: "12,847", c: C.ink }, { p: t.dToReview, v: "3", c: C.amber }]
              : [{ p: t.dProtected, v: "2", c: acc.deep }, { p: "Signals", v: "2", c: C.ink }, { p: t.dGuardians, v: "3", c: acc.deep }]
            ).map((k) => (
              <div key={k.p} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 11, padding: 12 }}>
                <p style={{ margin: 0, fontSize: 10, color: C.faint, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{k.p}</p>
                <b style={{ display: "block", marginTop: 5, fontSize: 24, fontWeight: 800, color: k.c, fontFamily: disp }}>{k.v}</b>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 11, padding: 13 }}>
            <h5 style={{ margin: "0 0 10px", fontSize: 12, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{mode === "business" ? t.dActionQueue : t.dSignals}</h5>
            {mode === "business" ? (
              <>
                <div style={{ display: "flex", gap: 10 }}>
                  <Face src={IMG.adam} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Adam Král</div>
                    <div style={{ fontSize: 10, color: C.faint, fontFamily: mono }}>@adamk_ · comment</div>
                    <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.5 }}>&ldquo;Total scam, don&rsquo;t buy from these clowns 🤡&rdquo;</p>
                  </div>
                </div>
                <div style={{ marginTop: 8, height: 5, borderRadius: 9, background: "#eef2f8", overflow: "hidden" }}><i style={{ display: "block", height: "100%", width: "82%", background: `linear-gradient(90deg, ${C.amber}, ${C.red})` }} /></div>
                <div style={{ marginTop: 10, display: "flex", gap: 7 }}>
                  <button style={{ flex: 1, borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", padding: 7, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: mono, color: C.dim }}>Reject</button>
                  <button style={{ flex: 1.5, borderRadius: 8, border: 0, color: "#fff", background: `linear-gradient(180deg, ${acc.a2}, ${acc.a})`, padding: 7, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: mono }}>Hide</button>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {[{ img: IMG.sofia, n: "Sofia", s: "14 · Instagram" }, { img: IMG.jakub, n: "Jakub", s: "11 · YouTube" }].map((p) => (
                  <div key={p.n} style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px" }}>
                    <Face src={p.img} size={34} />
                    <div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{p.n}</div><div style={{ fontSize: 10.5, color: C.faint }}>{p.s}</div></div>
                    <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 10, fontWeight: 700, color: C.green }}>● {t.dProtected}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- pricing group ---------- */
function PriceGroup({ title, plans, prices, acc, per, custom, popular, priceFor }: {
  title: string; plans: Plan[]; prices: (number | null)[]; acc: typeof BIZ; per: string; custom: string; popular: string; priceFor: (v: number | null) => string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0 14px", fontFamily: mono, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>
        {title}<span style={{ flex: 1, height: 1, background: C.line }} />
      </div>
      <div className="tmr-cards" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {plans.map((p, i) => {
          const pop = i === 1;
          const pv = prices[i] ?? null;
          const price = priceFor(pv);
          return (
            <div key={p.name} style={{ position: "relative", border: pop ? `1px solid color-mix(in srgb, ${acc.a} 40%, transparent)` : `1px solid ${C.line}`, borderRadius: 16, background: "#fff", padding: 22, boxShadow: pop ? `0 16px 40px color-mix(in srgb, ${acc.a} 22%, transparent)` : "0 10px 30px rgba(15,23,42,.05)" }}>
              {pop ? <span style={{ position: "absolute", top: 16, right: 16, background: acc.a, color: "#fff", fontFamily: mono, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 6 }}>{popular}</span> : null}
              <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: pop ? acc.deep : C.dim }}>{p.name}</div>
              <div style={{ margin: "16px 0 6px", display: "flex", alignItems: "baseline", gap: 5 }}>
                <b style={{ fontSize: 31, fontWeight: 800, letterSpacing: "-0.02em", fontFamily: disp }}>{price}</b>
                {pv != null ? <span style={{ fontFamily: mono, fontSize: 11, color: C.faint }}>{per}</span> : null}
              </div>
              <div style={{ fontSize: 12.5, color: C.dim, minHeight: 36, lineHeight: 1.5 }}>{p.tagline}</div>
              <Link href={pv == null ? "/contact" : "/register"} style={{ marginTop: 14, display: "block", textAlign: "center", fontFamily: mono, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", padding: 11, borderRadius: 10, ...(pop ? { border: 0, color: "#fff", background: `linear-gradient(180deg, ${acc.a2}, ${acc.a})` } : { border: `1px solid ${C.line}`, color: C.ink }) }}>{p.cta}</Link>
              <ul style={{ margin: "16px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, color: C.dim }}>
                {p.features.map((f) => (
                  <li key={f} style={{ display: "flex", gap: 8 }}><b style={{ color: acc.deep }}>▸</b>{f}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
