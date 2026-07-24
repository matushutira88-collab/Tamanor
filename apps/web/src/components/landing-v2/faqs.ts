import type { Locale } from "@/i18n";

/**
 * Landing FAQ content — a plain (server-safe, NO "use client") module so BOTH the client
 * LandingV2 component (which renders the accordion) and the server landing pages (which emit
 * FAQPage JSON-LD via faqLd) share a single source of truth. Keeping them in sync is what makes
 * the structured data actually match what a visitor sees.
 */
export type LandingFaq = { q: string; a: string };

const FAQS: Record<string, LandingFaq[]> = {
  en: [
    { q: "Which platforms does Tamanor support?", a: "Today: Facebook Pages (comments + auto-hide), Instagram Business (comments), YouTube (read-only) and Google Business Profile (reviews). LinkedIn and TikTok are in research. Capabilities are never guessed — an unsupported action simply isn't shown." },
    { q: "Does Tamanor delete comments?", a: "No. It hides clearly harmful comments from the public where the platform API allows it — the author and admins can still see them — and routes anything uncertain to a human. Every action is logged and reversible." },
    { q: "For families — do you read private messages?", a: "No. Tamanor flags risky contact and harmful content as a signal to the guardian; it never hands you a child's private conversations. Consent-first and age-appropriate by design." },
    { q: "How do you access accounts?", a: "Only through each platform's official OAuth. We never scrape, and never ask for or store passwords." },
    { q: "Is there a free trial?", a: "Yes — start free, no card. Business plans include a trial; Family is free during the beta pilot." },
    { q: "Is it GDPR-friendly?", a: "Data is tenant-scoped, tokens are encrypted and never logged, and disconnecting clears stored credentials. A DPA is available for Business plans." },
  ],
  sk: [
    { q: "Ktoré platformy Tamanor podporuje?", a: "Dnes: Facebook stránky (komentáre + auto-skrytie), Instagram Business (komentáre), YouTube (len na čítanie) a Google Business Profile (recenzie). LinkedIn a TikTok sú vo výskume. Schopnosti sa nikdy nehádajú — nepodporovaná akcia sa jednoducho nezobrazí." },
    { q: "Maže Tamanor komentáre?", a: "Nie. Jasne škodlivé komentáre skryje pred verejnosťou tam, kde to API platformy dovolí — autor a admini ich stále vidia — a čokoľvek nejasné posunie človeku. Každá akcia je zaznamenaná a vratná." },
    { q: "Pre rodiny — čítate súkromné správy?", a: "Nie. Tamanor označí rizikový kontakt a škodlivý obsah ako signál pre opatrovníka; nikdy vám nedá súkromné konverzácie dieťaťa. Súhlas na prvom mieste a primerané veku od návrhu." },
    { q: "Ako pristupujete k účtom?", a: "Len cez oficiálny OAuth každej platformy. Nikdy nescrapujeme a nikdy nežiadame ani neukladáme heslá." },
    { q: "Existuje skúšobná verzia zdarma?", a: "Áno — začnite zdarma, bez karty. Business plány obsahujú skúšobné obdobie; Family je zdarma počas beta pilotu." },
    { q: "Je to v súlade s GDPR?", a: "Dáta sú viazané na tenanta, tokeny sú šifrované a nikdy sa nelogujú, a odpojenie vymaže uložené prístupy. Pre Business plány je dostupná DPA." },
  ],
  de: [
    { q: "Welche Plattformen unterstützt Tamanor?", a: "Heute: Facebook-Seiten (Kommentare + Auto-Ausblenden), Instagram Business (Kommentare), YouTube (nur lesen) und Google Business Profile (Bewertungen). LinkedIn und TikTok sind in Forschung. Fähigkeiten werden nie geraten — eine nicht unterstützte Aktion wird einfach nicht angezeigt." },
    { q: "Löscht Tamanor Kommentare?", a: "Nein. Eindeutig schädliche Kommentare werden vor der Öffentlichkeit ausgeblendet, wo die Plattform-API es erlaubt — Autor und Admins sehen sie weiterhin — und alles Unklare geht an einen Menschen. Jede Aktion wird protokolliert und ist umkehrbar." },
    { q: "Für Familien — lest ihr private Nachrichten?", a: "Nein. Tamanor meldet riskanten Kontakt und schädliche Inhalte als Signal an die Erziehungsberechtigten; es gibt dir niemals die privaten Gespräche eines Kindes. Einwilligung zuerst und altersgerecht by design." },
    { q: "Wie greift ihr auf Konten zu?", a: "Nur über das offizielle OAuth jeder Plattform. Wir scrapen nie und fragen niemals nach Passwörtern oder speichern sie." },
    { q: "Gibt es eine kostenlose Testversion?", a: "Ja — kostenlos starten, ohne Karte. Business-Pläne enthalten eine Testphase; Family ist während des Beta-Pilots kostenlos." },
    { q: "Ist es DSGVO-freundlich?", a: "Daten sind mandantenbezogen, Tokens sind verschlüsselt und werden nie protokolliert, und beim Trennen werden gespeicherte Zugangsdaten gelöscht. Ein AVV ist für Business-Pläne verfügbar." },
  ],
};

export function landingFaqs(locale: Locale): LandingFaq[] {
  return FAQS[locale] ?? FAQS.en!;
}
