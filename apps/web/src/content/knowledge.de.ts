// German (DE) overlay for the knowledge base. Keyed by entry slug.
// Any field left out falls back to the English source in knowledge.ts.
import type { KnowledgeEntryL10n } from "./knowledge";

export const knowledgeDe: Record<string, KnowledgeEntryL10n> = {
  "what-is-tamanor": {
    title: "Was ist Tamanor?",
    metaTitle: "Was ist Tamanor? — Social Account Firewall",
    summary:
      "Tamanor ist eine Social Account Firewall, die Kommentare und Bewertungen auf verbundenen Social-Media-Konten überwacht, Risiken mit KI erkennt und sichere Moderationsmaßnahmen vorbereitet, die ein Mensch freigibt.",
    keywords: ["was ist tamanor", "social account firewall", "kommentarmoderation", "schutz der markenreputation"],
    sections: [
      {
        heading: "Eine Firewall für Ihre Social-Media-Präsenz",
        body: [
          "Tamanor verbindet sich mit den Social-Media-Konten, die eine Marke bereits besitzt, und liest deren Kommentare und Bewertungen fortlaufend aus. Es klassifiziert jedes Element nach Risiko — Spam, Betrug, Belästigung und wiederholtes riskantes Verhalten — und hebt hervor, was Aufmerksamkeit erfordert.",
          "Tamanor ist standardmäßig schreibgeschützt. Wenn eine Moderationsmaßnahme angebracht ist, bereitet Tamanor sie vor, und ein Mensch gibt sie frei, bevor auf der Plattform etwas geschieht. Es postet, antwortet oder löscht niemals von sich aus.",
        ],
      },
      {
        heading: "Für wen es gedacht ist",
        body: [
          "Marken, Agenturen, E-Commerce-Shops, Creator und lokale Unternehmen, die öffentliche Kommentare und Bewertungen erhalten und ihre Reputation schützen müssen, ohne jeden Kanal von Hand zu beobachten.",
        ],
      },
    ],
    faqs: [
      { q: "Postet oder antwortet Tamanor in meinem Namen?", a: "Nein. Tamanor ist standardmäßig schreibgeschützt und bereitet nur Maßnahmen vor; ein Mensch gibt jede Moderationsmaßnahme frei, bevor sie ausgeführt wird." },
      { q: "Welche Konten kann Tamanor schützen?", a: "Facebook-Seiten sind live und verifiziert. Der Instagram-Professional-Connector ist implementierungsfertig, aber die Verifizierung steht noch aus, und Google Business ist eine Grundlage, die auf genehmigten API-Zugriff wartet. Die Verbindung erfolgt ausschließlich über offizielles OAuth." },
    ],
  },
  "how-tamanor-works": {
    title: "So funktioniert Tamanor",
    metaTitle: "So funktioniert Tamanor — Überwachung, Risikoerkennung, Freigabe",
    summary:
      "Tamanor verbindet sich über offizielles OAuth, liest Kommentare und Bewertungen nach Zeitplan und über Webhooks, klassifiziert Risiken mit KI und leitet vorgeschlagene Maßnahmen durch eine menschliche Freigabe-Warteschlange.",
    keywords: ["wie tamanor funktioniert", "workflow zur kommentarüberwachung", "moderation mit menschlicher freigabe", "oauth social media"],
    sections: [
      {
        heading: "Verbinden",
        body: [
          "Sie verbinden ein Konto über den offiziellen OAuth-Ablauf der Plattform. Tamanor speichert nur OAuth-Tokens (in der Produktion verschlüsselt gespeichert) — niemals ein Passwort, und es betreibt kein Scraping.",
        ],
      },
      {
        heading: "Überwachen",
        body: [
          "Ein Hintergrundprozess liest neue Kommentare und Bewertungen nach Zeitplan, und Webhooks liefern Ereignisse nahezu in Echtzeit. Jedes abgerufene Element wird normalisiert und dedupliziert, sodass derselbe Kommentar niemals zweimal verarbeitet wird.",
        ],
      },
      {
        heading: "Erkennen & vorschlagen",
        body: [
          "Jedes Element wird von einer hybriden Engine (Markenregeln plus KI-Risikoanalyse) in eine Risikostufe und Kategorie eingeordnet. Elemente mit hohem Risiko können eine vorgeschlagene Maßnahme erzeugen, aber Tamanor schlägt nur vor — es führt niemals automatisch aus.",
        ],
      },
      {
        heading: "Freigeben",
        body: [
          "Vorgeschlagene Maßnahmen warten in einer Freigabe-Warteschlange. Ein Prüfer mit der passenden Rolle gibt sie frei oder lehnt sie ab. Als Live-Maßnahme ist heute nur das Ausblenden von Facebook-Kommentaren aktiviert, und nur nach Freigabe, wobei der gesamte Ablauf in ein unveränderliches Audit-Log geschrieben wird.",
        ],
      },
    ],
    faqs: [
      { q: "Wie aktuell sind die Daten?", a: "Geplante Lesevorgänge plus Webhook-Ereignisse. Abfragen und Webhooks werden dedupliziert, sodass ihre Koexistenz niemals doppelte Elemente erzeugt." },
      { q: "Welche Maßnahmen kann Tamanor ergreifen?", a: "Heute das kontrollierte Ausblenden von Facebook-Kommentaren nach menschlicher Freigabe. Alles andere ist Überwachung und Analyse." },
    ],
  },
  "why-tamanor": {
    title: "Warum Tamanor",
    metaTitle: "Warum Tamanor — sichere, ehrliche Moderation mit dem Menschen in der Schleife",
    summary:
      "Tamanor ist standardmäßig sicher konzipiert: nur offizielles OAuth, standardmäßig schreibgeschützt, menschliche Freigabe vor jeder Maßnahme, mandantengetrennte Isolation auf Zeilenebene und ein vollständiger Audit-Trail.",
    keywords: ["warum tamanor", "sichere moderation", "mensch in der schleife", "software für markensicherheit"],
    sections: [
      {
        heading: "Sicher durch Design",
        body: [
          "Kein Scraping, keine gespeicherten Passwörter, keine automatische Ausführung. Tamanor bietet eine Maßnahme nur an, wenn die Plattform sie tatsächlich unterstützt und ein Mensch sie freigegeben hat.",
        ],
      },
      {
        heading: "Ehrlich in Bezug auf Fähigkeiten",
        body: [
          "Tamanor bewirbt nur das, was es pro Plattform tatsächlich leisten kann. Wo eine Plattform noch nicht unterstützt wird, sagt es dies, anstatt so zu tun als ob. Die Fähigkeiten werden aus einer einzigen verlässlichen Quelle im Code gelesen.",
        ],
      },
    ],
    faqs: [
      { q: "Ist Tamanor vollständig automatisiert?", a: "Nein — die Automatisierung bereitet Vorschläge vor; ein Mensch behält die Kontrolle über jede Maßnahme." },
    ],
  },
  "architecture": {
    title: "Tamanor-Architektur",
    metaTitle: "Architektur — Tamanor mandantenfähig, Lesen→HTTP→Schreiben",
    summary:
      "Tamanor ist eine mandantenfähige Anwendung mit einer Next.js-Web-App, einem Hintergrundprozess, PostgreSQL mit Sicherheit auf Zeilenebene und injizierbaren Plattform-Connectors, die Netzwerkaufrufe an Anbieter von Datenbanktransaktionen isolieren.",
    keywords: ["tamanor architektur", "mandantenfähige saas-architektur", "sicherheit auf zeilenebene", "hintergrundprozess"],
    sections: [
      {
        heading: "Komponenten",
        body: [
          "Eine Next.js-Webanwendung stellt das Dashboard und die Marketing-Website bereit. Ein separater Worker-Prozess führt geplante Überwachung, Token-Zustandsprüfungen und Webhook-Nachbearbeitung aus. PostgreSQL ist das führende System.",
          "Plattform-Connectors sind injizierbar: die Produktion nutzt echte offizielle API-Transporte, und Tests injizieren Mock-Transporte, sodass exakt der Produktionscode ohne jeden Netzwerkaufruf läuft.",
        ],
      },
      {
        heading: "Lesen → Anbieter-HTTP → Schreiben",
        body: [
          "Datenbankarbeit läuft in kurzen mandantenbezogenen Transaktionen. HTTP-Aufrufe an Anbieter erfolgen strikt zwischen Transaktionen, niemals innerhalb einer, sodass ein langsamer oder ausfallender Anbieter niemals eine Datenbanksperre halten oder den lokalen Zustand beschädigen kann.",
        ],
      },
    ],
    faqs: [
      { q: "Teilt der Worker den Datenbankzugriff der Web-App?", a: "Beide nutzen dieselbe Laufzeitrolle mit Sicherheit auf Zeilenebene; keiner kann die Mandantentrennung umgehen." },
    ],
  },
  "security": {
    title: "Tamanor-Sicherheit",
    metaTitle: "Sicherheit — Tamanor nur OAuth, standardmäßig schreibgeschützt",
    summary:
      "Tamanor verbindet sich ausschließlich über offizielles OAuth, betreibt niemals Scraping, speichert niemals Passwörter, hält Tokens serverseitig und aus Logs heraus und ist standardmäßig schreibgeschützt mit menschlicher Freigabe vor jeder Maßnahme.",
    keywords: ["tamanor sicherheit", "nur oauth", "kein scraping", "sicherheit für markensicherheit"],
    sections: [
      {
        heading: "Verbindungen",
        body: [
          "Nur offizielle OAuth- und API-Integrationen. Tamanor betreibt auf keiner Plattform Scraping und fragt niemals Social-Media-Passwörter ab oder speichert sie. Prüfungen der Plattformfähigkeiten laufen, bevor eine Maßnahme angeboten wird.",
        ],
      },
      {
        heading: "Tokens",
        body: [
          "OAuth-Tokens werden ausschließlich serverseitig gespeichert, in der Produktion verschlüsselt. Sie werden niemals in der Oberfläche angezeigt, niemals in Logs geschrieben und niemals in den Audit-Trail aufgenommen.",
        ],
      },
      {
        heading: "Isolation & Audit",
        body: [
          "Die Daten jedes Mandanten sind durch PostgreSQL-Sicherheit auf Zeilenebene isoliert. Jede bedeutsame Maßnahme wird in einem ausschließlich anfügenden Audit-Log erfasst.",
        ],
      },
    ],
    faqs: [
      { q: "Speichern Sie mein Social-Media-Passwort?", a: "Niemals. Tamanor nutzt offizielles OAuth; Passwörter werden weder abgefragt noch gespeichert." },
      { q: "Werden Tokens jemals protokolliert?", a: "Nein. Tokens werden aus Logs, der Oberfläche, Fehlermeldungen und dem Audit-Trail herausgehalten." },
    ],
  },
  "row-level-security": {
    title: "Sicherheit auf Zeilenebene (RLS)",
    metaTitle: "Sicherheit auf Zeilenebene — Tamanor Mandantentrennung",
    summary:
      "Tamanor erzwingt die Mandantentrennung auf Datenbankebene mit PostgreSQL-Sicherheit auf Zeilenebene, sodass ein vergessener Filter im Anwendungscode niemals die Daten eines anderen Mandanten preisgeben kann.",
    keywords: ["sicherheit auf zeilenebene", "postgres rls", "mandantentrennung", "mandantensicherheit"],
    sections: [
      {
        heading: "Isolation in der Datenbank, nicht nur in der App",
        body: [
          "Jede mandantenbezogene Abfrage läuft über eine Datenbankrolle ohne Superuser-Rechte mit FORCE ROW LEVEL SECURITY und einer Richtlinie zur Mandantentrennung. Der aktuelle Mandant wird pro Transaktion gesetzt; die Datenbank selbst weist Zeilen jedes anderen Mandanten ab.",
          "Das ist gestaffelte Verteidigung: Selbst wenn der Anwendungscode einen Mandantenfilter vergessen hätte, gibt die Datenbank weiterhin nur die Zeilen des aktiven Mandanten zurück.",
        ],
      },
    ],
    faqs: [
      { q: "Was passiert, wenn eine Abfrage vergisst, nach Mandant zu filtern?", a: "Die Sicherheit auf Zeilenebene beschränkt die Ergebnisse weiterhin auf den aktiven Mandanten — die Isolation hängt nicht davon ab, dass der Anwendungscode daran denkt zu filtern." },
    ],
  },
  "audit-log": {
    title: "Audit-Log",
    metaTitle: "Audit-Log — Tamanor ausschließlich anfügende Aktionshistorie",
    summary:
      "Tamanor erfasst jede bedeutsame Maßnahme — Verbindungen, Synchronisierungen, Vorschläge, Freigaben und Moderation — in einem ausschließlich anfügenden, mandantenbezogenen Audit-Log, das niemals Token-Material enthält.",
    keywords: ["audit-log", "audit-trail für moderation", "compliance-protokollierung", "aktionshistorie"],
    sections: [
      {
        heading: "Jede Maßnahme, dauerhaft erfasst",
        body: [
          "Das Verbinden eines Kontos, das Ausführen einer Synchronisierung, das Vorschlagen einer Maßnahme, das Freigeben oder Ablehnen und das Ausführen eines freigegebenen Ausblendens werden jeweils mit Akteur, Ziel und Metadaten in das Audit-Log geschrieben. Einträge werden ausschließlich angefügt und sind auf den Mandanten beschränkt.",
          "Audit-Metadaten werden von Geheimnissen bereinigt: kein Token, kein Passwort und keine Datenbank-URL erscheint jemals in einem Audit-Eintrag.",
        ],
      },
    ],
    faqs: [
      { q: "Können Audit-Einträge bearbeitet oder gelöscht werden?", a: "Das Audit-Log wird ausschließlich angefügt; Einträge werden nicht an Ort und Stelle bearbeitet." },
    ],
  },
  "permission-model": {
    title: "Berechtigungsmodell",
    metaTitle: "Berechtigungsmodell — Tamanor Plattform- + Rollenberechtigungen",
    summary:
      "Tamanor trennt die Plattformfähigkeit (was die OAuth-Freigabe eines Kontos tatsächlich erlaubt) von den Arbeitsbereichsrollen (was ein Teammitglied tun darf) und bietet eine Maßnahme nur an, wenn beide sie zulassen.",
    keywords: ["berechtigungsmodell", "oauth-berechtigungen", "rollenbasierter zugriff", "fähigkeitsprüfungen"],
    sections: [
      {
        heading: "Zwei Berechtigungsebenen",
        body: [
          "Die Plattformberechtigung ist die Wahrheit darüber, was das verbundene Konto tun kann — Kommentare lesen, einen Kommentar ausblenden, Bewertungen lesen — abgeleitet aus der OAuth-Freigabe und der Plattform-API. Die Arbeitsbereichsberechtigung ist das, was die Rolle eines Teammitglieds innerhalb von Tamanor erlaubt.",
          "Eine Maßnahme wird nur angeboten, wenn die Plattform sie unterstützt UND die Rolle des Nutzers sie zulässt. Fehlende Plattformberechtigungen werden ehrlich als Aufforderung zum erneuten Verbinden bzw. zur erneuten Freigabe dargestellt.",
        ],
      },
    ],
    faqs: [
      { q: "Was passiert, wenn eine Berechtigung auf der Plattform widerrufen wird?", a: "Tamanor erkennt die widerrufene Berechtigung bei seiner nächsten Prüfung und zeigt eine Aufforderung zum erneuten Verbinden an, anstatt stillschweigend zu scheitern." },
    ],
  },
  "role-model": {
    title: "Rollenmodell",
    metaTitle: "Rollenmodell — Tamanor Arbeitsbereichsrollen",
    summary:
      "Tamanor verwendet rollenbasierten Zugriff innerhalb jedes Arbeitsbereichs, sodass Eigentümer, Administratoren, Analysten, Prüfer und Betrachter nur das sehen und tun, was ihre Rolle erlaubt.",
    keywords: ["rollenbasierte zugriffskontrolle", "rbac", "arbeitsbereichsrollen", "teamberechtigungen"],
    sections: [
      {
        heading: "Rollen passen zur Aufgabe",
        body: [
          "Arbeitsbereichsrollen legen fest, wer Konten verbinden kann, wer Moderationsmaßnahmen freigeben kann und wer nur Analysen ansehen darf. Rollenprüfungen laufen serverseitig bei jeder geschützten Maßnahme, aufgesetzt auf die Datenbank-Sicherheit auf Zeilenebene.",
        ],
      },
    ],
    faqs: [
      { q: "Kann ein Betrachter eine Moderationsmaßnahme freigeben?", a: "Nein. Die Freigabe ist auf Rollen beschränkt, die sie erlauben; Betrachter können lesen, aber nicht handeln." },
    ],
  },
  "webhook-architecture": {
    title: "Webhook-Architektur",
    metaTitle: "Webhook-Architektur — Tamanor signierte, deduplizierte Ereignisse",
    summary:
      "Tamanor verifiziert die Signatur jedes eingehenden Webhooks, leitet Facebook- und Instagram-Ereignisse über einen einheitlichen Connector, weist Wiederholungen ab und löst den Mandanten stets aus dem verbundenen Konto auf — niemals aus der Nutzlast.",
    keywords: ["webhook-architektur", "verifizierung der webhook-signatur", "wiederholungsschutz", "meta webhooks"],
    sections: [
      {
        heading: "Vertrauenswürdig durch Konstruktion",
        body: [
          "Eingehende Ereignisse werden mit einer HMAC-Signatur verifiziert, bevor irgendetwas als vertrauenswürdig gilt. Ein stabiler Dedup-Schlüssel weist wiederholte Zustellungen ab. Nur signaturgültige Ereignisse werden jemals verarbeitet; gefälschte oder unsignierte Ereignisse werden für das Audit gespeichert, aber es wird niemals auf ihrer Grundlage gehandelt.",
          "Der Mandant wird stets aus dem zugeordneten verbundenen Konto abgeleitet, niemals aus dem Webhook-Rumpf, sodass eine manipulierte Nutzlast keine Mandantengrenzen überschreiten kann.",
        ],
      },
    ],
    faqs: [
      { q: "Was verhindert einen wiederholten oder gefälschten Webhook?", a: "Signaturverifizierung plus ein eindeutiger Dedup-Schlüssel: Wiederholungen werden zu einem Ereignis zusammengefasst und unsignierte Ereignisse werden niemals verarbeitet." },
    ],
  },
  "worker-architecture": {
    title: "Worker-Architektur",
    metaTitle: "Worker-Architektur — Tamanor geplante Überwachung",
    summary:
      "Ein separater Tamanor-Worker führt geplante schreibgeschützte Überwachung, Prüfungen des Token-Ablaufs und Webhook-Nachbearbeitung aus, jeweils in einem vertrauenswürdigen Mandantenkontext und mit einer kontobezogenen Sperre, die überlappende Synchronisierungen verhindert.",
    keywords: ["hintergrundprozess", "geplante synchronisierung", "synchronisierungssperre", "token-monitor"],
    sections: [
      {
        heading: "Eine Synchronisierung pro Konto, sicher",
        body: [
          "Der Worker erwirbt vor der Synchronisierung eine kurzlebige kontobezogene Sperre, sodass ein geplanter Lauf und ein manueller Lauf niemals kollidieren können. Lesevorgänge sind idempotent; jedes Element wird einmal erstellt und bei Änderung an Ort und Stelle aktualisiert.",
          "Der Worker liest nur. Er führt niemals eine Moderationsmaßnahme aus; diese laufen ausschließlich durch die Freigabe-Warteschlange.",
        ],
      },
    ],
    faqs: [
      { q: "Können zwei Synchronisierungen für dasselbe Konto gleichzeitig laufen?", a: "Nein. Eine kontobezogene Sperre garantiert eine einzige aktive Synchronisierung; der zweite Lauf wird sauber übersprungen." },
    ],
  },
  "data-protection": {
    title: "Datenschutz",
    metaTitle: "Datenschutz — Tamanor minimale, isolierte Daten",
    summary:
      "Tamanor speichert nur die OAuth-Tokens und öffentlichen Inhalte, die zum Schutz einer Marke nötig sind, isoliert sie pro Mandant mit Sicherheit auf Zeilenebene, hält Geheimnisse aus Logs heraus und bereinigt kurzlebige Onboarding-Daten automatisch.",
    keywords: ["datenschutz", "datenminimierung", "dsgvo-bereitschaft", "mandantendatentrennung"],
    sections: [
      {
        heading: "Weniger speichern, mehr schützen",
        body: [
          "Tamanor erfasst öffentliche Kommentare und Bewertungen sowie die OAuth-Tokens, die zum Lesen erforderlich sind. Tokens werden in der Produktion verschlüsselt gespeichert und niemals offengelegt. Kurzlebige Onboarding-Sitzungen, die temporäre Tokens enthalten, werden automatisch gelöscht, sobald sie ablaufen.",
        ],
      },
    ],
    faqs: [
      { q: "Werden Daten zwischen Kunden geteilt?", a: "Nein. Die Sicherheit auf Zeilenebene isoliert die Daten jedes Mandanten auf Datenbankebene." },
    ],
  },
  "privacy": {
    title: "Datenschutz (Privatsphäre)",
    metaTitle: "Privatsphäre — Tamanor Datenverarbeitung",
    summary:
      "Tamanor verarbeitet öffentliche Social-Media-Inhalte und OAuth-Tokens ausschließlich zum Zweck des Schutzes der verbundenen Marke, mit Mandantentrennung, Bereinigung von Geheimnissen und ohne Verkauf von Daten.",
    keywords: ["privatsphäre", "datenschutz der privatsphäre", "verarbeitung von social-media-daten"],
    sections: [
      {
        heading: "Zweckgebundene Verarbeitung",
        body: [
          "Inhalte und Tokens werden nur verarbeitet, um die Konten zu überwachen und zu schützen, die ein Kunde verbindet. Tamanor verkauft keine Kundendaten. Die maßgebliche Aussage finden Sie in der Datenschutzerklärung.",
        ],
      },
    ],
    faqs: [
      { q: "Wo befindet sich die maßgebliche Datenschutzerklärung?", a: "Die Seite mit der Datenschutzerklärung ist die maßgebliche Quelle; diese Seite fasst die technische Ausrichtung zusammen." },
    ],
  },
  "encryption": {
    title: "Verschlüsselung",
    metaTitle: "Verschlüsselung — Tamanor Token-Verschlüsselung im Ruhezustand",
    summary:
      "Tamanor verschlüsselt OAuth-Tokens im Ruhezustand in der Produktion und verhindert die Speicherung von Klartext-Tokens in der Produktion, sodass Zugangsdaten selbst auf der Datenbankebene geschützt sind.",
    keywords: ["verschlüsselung im ruhezustand", "token-verschlüsselung", "kms", "schutz von zugangsdaten"],
    sections: [
      {
        heading: "Tokens im Ruhezustand verschlüsselt",
        body: [
          "In der Produktion werden OAuth-Tokens vor der Speicherung verschlüsselt, und eine Sicherheitsprüfung verhindert, dass Klartext-Tokens dauerhaft gespeichert werden. Tokens werden nur im Arbeitsspeicher entschlüsselt, wenn ein Lesevorgang erfolgt, und werden niemals protokolliert oder angezeigt.",
        ],
      },
    ],
    faqs: [
      { q: "Werden Tokens im Klartext gespeichert?", a: "Nicht in der Produktion — die Klartext-Speicherung von Tokens ist blockiert und Tokens werden im Ruhezustand verschlüsselt." },
    ],
  },
  "ai-moderation": {
    title: "KI-Moderation",
    metaTitle: "KI-Moderation — Tamanor Risikoerkennung mit menschlicher Freigabe",
    summary:
      "Die KI von Tamanor klassifiziert jeden Kommentar und jede Bewertung nach Risiko und Kategorie, kombiniert Markenregeln mit KI-Analyse und schlägt dann Maßnahmen zur menschlichen Freigabe vor — sie moderiert niemals automatisch.",
    keywords: ["ki-moderation", "risikoerkennung bei kommentaren", "inhaltsklassifizierung", "markenregeln"],
    sections: [
      {
        heading: "Hybride Klassifizierung",
        body: [
          "Jedes Element wird von einer hybriden Engine bewertet: deterministische Markenregeln plus KI-Risikoanalyse. Das Ergebnis ist eine Risikostufe, Kategorien und eine Stimmung, die genutzt werden, um zu priorisieren, was ein Mensch zuerst sieht.",
          "Die KI-Ausgabe steuert ausschließlich Vorschläge und Priorisierung. Ein Mensch gibt jede Maßnahme frei, die eine Plattform berührt.",
        ],
      },
    ],
    faqs: [
      { q: "Blendet die KI Kommentare von sich aus aus?", a: "Nein. Die KI erkennt und schlägt vor; das Ausblenden eines Kommentars erfordert menschliche Freigabe." },
    ],
  },
  "automation": {
    title: "Automatisierung",
    metaTitle: "Automatisierung — Tamanor schlägt vor, Menschen entscheiden",
    summary:
      "Tamanor automatisiert Überwachung, Risikoerkennung und die Vorbereitung von Maßnahmen, hält die Ausführung aber menschlich freigegeben: Die Automatisierung erstellt Vorschläge, sie führt Moderation niemals von sich aus aus.",
    keywords: ["moderationsautomatisierung", "sichere automatisierung", "automatisierung mit dem menschen in der schleife"],
    sections: [
      {
        heading: "Die Arbeit automatisieren, nicht die Entscheidung",
        body: [
          "Geplante Überwachung, deduplizierte Erfassung, Risikobewertung und Erzeugung von Vorschlägen sind automatisiert. Die Entscheidung zu handeln bleibt bei einem Menschen, sodass die Automatisierung niemals ohne Freigabe postet, ausblendet oder löscht.",
        ],
      },
    ],
    faqs: [
      { q: "Kann ich vollautomatisches Ausblenden aktivieren?", a: "Die automatische Ausführung ist bewusst nicht aktiviert; Vorschläge werden zur menschlichen Freigabe vorbereitet." },
    ],
  },
  "proposal-engine": {
    title: "Vorschlags-Engine",
    metaTitle: "Vorschlags-Engine — Tamanor bereitet sichere Maßnahmen vor",
    summary:
      "Für Elemente mit hohem Risiko bereitet Tamanor eine vorgeschlagene Moderationsmaßnahme mit Kontext vor und leitet sie an die Freigabe-Warteschlange; es schlägt vor, führt aber niemals automatisch aus.",
    keywords: ["vorschlags-engine", "moderationsvorschläge", "freigabe-warteschlange", "erkennung hohen risikos"],
    sections: [
      {
        heading: "Vom Risiko zu einem prüfbaren Vorschlag",
        body: [
          "Wenn ein Element ein hohes Risiko aufweist und keinen offenen Vorschlag hat, bereitet Tamanor einen vor. Der Vorschlag enthält Grund und Ziel, sodass ein Prüfer schnell entscheiden kann. Nichts erreicht eine Plattform, bevor der Vorschlag freigegeben ist.",
        ],
      },
    ],
    faqs: [
      { q: "Laufen Vorschläge ab oder werden sie doppelt erzeugt?", a: "Tamanor vermeidet doppelte Vorschläge für dasselbe Element und hält jeden Vorschlag in der Warteschlange prüfbar." },
    ],
  },
  "roadmap": {
    title: "Roadmap",
    metaTitle: "Roadmap — Tamanor ehrlicher Plattformstatus",
    summary:
      "Die Kommentarüberwachung von Facebook-Seiten ist verifiziert und live. Instagram ist implementierungsfertig, aber die Verifizierung steht aus (Meta App Review). Google Business ist eine Grundlage, die auf genehmigten API-Zugriff wartet. YouTube, LinkedIn und TikTok befinden sich in der Recherche — nicht unterstützt.",
    keywords: ["tamanor roadmap", "plattformunterstützung", "instagram verifizierung ausstehend", "google business bewertungen"],
    sections: [
      {
        heading: "Was live ist, was ausstehend ist, was Recherche ist",
        body: [
          "Live (verifiziert): schreibgeschützte Kommentarüberwachung von Facebook-Seiten, mit menschlich freigegebenem Ausblenden, das standardmäßig deaktiviert ist.",
          "Implementierung abgeschlossen, Verifizierung ausstehend: schreibgeschützte Kommentarüberwachung von Instagram Professional — wartet auf Meta App Review, bevor sie live geht.",
          "Grundlage, Verifizierung ausstehend: Überwachung von Google-Business-Bewertungen — bereit für genehmigten API-Zugriff, noch nicht live.",
          "Recherche (nicht unterstützt): YouTube, LinkedIn und TikTok. Tamanor beansprucht keine Unterstützung, solange sie nicht real und verifiziert ist.",
        ],
      },
    ],
    faqs: [
      { q: "Unterstützt Tamanor heute TikTok, YouTube oder LinkedIn?", a: "Noch nicht. Diese sind geplant; Tamanor sagt ehrlich, dass es keine Unterstützung dafür beansprucht, solange sie nicht verifiziert ist." },
    ],
  },
  "comment-monitoring": {
    title: "Überwachung von Kommentaren & Bewertungen",
    metaTitle: "Kommentarüberwachung — Tamanor",
    summary:
      "Tamanor liest fortlaufend Kommentare und Bewertungen auf verbundenen Konten, dedupliziert sie und klassifiziert jedes nach Risiko, sodass nichts Wichtiges übersehen wird.",
    keywords: ["kommentarüberwachung", "bewertungsüberwachung", "social listening", "markenerwähnungen"],
    sections: [
      {
        heading: "Verpassen Sie keinen riskanten Kommentar",
        body: [
          "Tamanor liest neue Kommentare und Bewertungen nach Zeitplan und über Webhooks, normalisiert sie in ein einziges Modell und dedupliziert nach Konto und externer ID, sodass dasselbe Element niemals zweimal gezählt wird.",
        ],
      },
    ],
    faqs: [{ q: "Welche Plattformen werden heute überwacht?", a: "Facebook-Seiten und verbundene Instagram-Professional-Konten sowie Google-Business-Bewertungen als Grundlage." }],
  },
  "reputation-analytics": {
    title: "Reputationsanalyse",
    metaTitle: "Reputationsanalyse — Tamanor",
    summary:
      "Tamanor verwandelt überwachte Kommentare und Bewertungen in Reputationsanalysen — Risikostufen, Kategorien und Trends — sodass eine Marke ihre Exposition auf einen Blick sehen kann.",
    keywords: ["reputationsanalyse", "markenreputation", "stimmung", "risikotrends"],
    sections: [
      {
        heading: "Sehen Sie Ihre Exposition",
        body: [
          "Klassifizierte Elemente werden nach Risikostufe und Kategorie zu Reputationsansichten zusammengefasst und helfen Teams, sich zuerst auf die Probleme mit der größten Auswirkung zu konzentrieren.",
        ],
      },
    ],
    faqs: [{ q: "Basiert die Analyse auf realen Inhalten?", a: "Ja — die Analysen werden aus den realen Kommentaren und Bewertungen berechnet, die Tamanor überwacht, nicht aus Beispieldaten." }],
  },
  "actor-risk": {
    title: "Akteursrisiko",
    metaTitle: "Akteursrisiko — Tamanor Erkennung von Wiederholungstätern",
    summary:
      "Tamanor verfolgt wiederholtes riskantes Verhalten desselben Autors über die Inhalte einer Marke hinweg, sodass hartnäckige böswillige Akteure hervorstechen, anstatt jeweils nach einem einzelnen Kommentar beurteilt zu werden.",
    keywords: ["akteursrisiko", "erkennung von wiederholungstätern", "koordinierter missbrauch", "autorenreputation"],
    sections: [
      {
        heading: "Beurteilen Sie das Muster, nicht nur einen Kommentar",
        body: [
          "Indem Tamanor Risiko im Zeitverlauf mit Autoren verknüpft, hebt es Konten hervor, die wiederholt Spam, Betrug oder Belästigung posten, und gibt Prüfern einen Kontext, den ein einzelner Kommentar nicht liefern kann.",
        ],
      },
    ],
    faqs: [{ q: "Sperrt Tamanor Autoren automatisch?", a: "Nein. Das Akteursrisiko informiert Prüfer; Tamanor sperrt Autoren nicht und ergreift keine automatischen Maßnahmen gegen sie." }],
  },
  "action-queue": {
    title: "Aktionswarteschlange",
    metaTitle: "Aktionswarteschlange — Tamanor menschlich freigegebene Maßnahmen",
    summary:
      "Die Aktionswarteschlange von Tamanor enthält vorgeschlagene Moderationsmaßnahmen zur menschlichen Prüfung; nichts wird auf einer Plattform ausgeführt, bevor ein Prüfer es freigibt.",
    keywords: ["aktionswarteschlange", "moderationswarteschlange", "freigabe-warteschlange"],
    sections: [
      {
        heading: "Ein einziger Ort zum Entscheiden",
        body: [
          "Vorgeschlagene Maßnahmen sammeln sich in einer Warteschlange mit dem nötigen Kontext für die Entscheidung. Die Freigabe führt die Maßnahme aus (heute das Ausblenden von Facebook-Kommentaren); die Ablehnung schließt sie. Jedes Ergebnis wird protokolliert.",
        ],
      },
    ],
    faqs: [{ q: "Welche Maßnahmen können heute freigegeben werden?", a: "Das kontrollierte Ausblenden von Facebook-Kommentaren. Andere Plattformen werden nur überwacht." }],
  },
  "approval-workflow": {
    title: "Freigabe-Workflow",
    metaTitle: "Freigabe-Workflow — Tamanor",
    summary:
      "Der Freigabe-Workflow von Tamanor hält einen Menschen in der Kontrolle: Vorgeschlagene Maßnahmen werden von einer autorisierten Rolle freigegeben oder abgelehnt, bevor etwas eine Plattform berührt, wobei jeder Schritt protokolliert wird.",
    keywords: ["freigabe-workflow", "mensch in der schleife", "moderationsfreigabe"],
    sections: [
      {
        heading: "Menschliche Kontrolle, durchgängig",
        body: [
          "Ein Vorschlag wird erstellt, von einer autorisierten Rolle geprüft und erst dann ausgeführt. Der vollständige Lebenszyklus — vorgeschlagen, freigegeben oder abgelehnt, ausgeführt — wird in das Audit-Log geschrieben.",
        ],
      },
    ],
    faqs: [{ q: "Wer kann freigeben?", a: "Nur Arbeitsbereichsrollen, die zur Freigabe berechtigt sind; Rollenprüfungen laufen serverseitig." }],
  },
  "auto-protection": {
    title: "Auto-Schutz-Richtlinien",
    metaTitle: "Auto-Schutz — Tamanor sichere Voreinstellungen",
    summary:
      "Auto-Schutz-Richtlinien ermöglichen es einer Marke, pro Kategorie festzulegen, wann Tamanor eine Schutzmaßnahme vorbereiten soll — weiterhin über die menschliche Freigabe geleitet, niemals automatisch ausgeführt.",
    keywords: ["auto-schutz", "moderationsrichtlinie", "sichere automatisierung", "markenregeln"],
    sections: [
      {
        heading: "Richtlinie hinein, Vorschläge heraus",
        body: [
          "Sie legen Richtlinien pro Kategorie dafür fest, wie aggressiv Tamanor reagieren soll. Richtlinien beeinflussen, was vorgeschlagen und priorisiert wird; sie aktivieren keine automatische Ausführung.",
        ],
      },
    ],
    faqs: [{ q: "Kann eine Richtlinie Kommentare automatisch ausblenden?", a: "Nein — Richtlinien formen Vorschläge; die Freigabe bleibt menschlich." }],
  },
  "control-center": {
    title: "Kontrollzentrum",
    metaTitle: "Kontrollzentrum — Tamanor Regeln und Einstellungen",
    summary:
      "Im Tamanor-Kontrollzentrum konfiguriert eine Marke Regeln, Kategorien und Schutzeinstellungen, die Überwachung und Vorschläge steuern.",
    keywords: ["kontrollzentrum", "moderationsregeln", "markenkonfiguration"],
    sections: [
      {
        heading: "Die Firewall konfigurieren",
        body: [
          "Markenregeln und Schutzeinstellungen befinden sich an einem Ort, sodass Teams abstimmen können, was als Risiko gilt und wie Vorschläge vorbereitet werden.",
        ],
      },
    ],
    faqs: [{ q: "Gelten Regeln pro Marke?", a: "Ja — Regeln und Richtlinien sind auf jede Marke innerhalb eines Arbeitsbereichs beschränkt." }],
  },
  "unified-inbox": {
    title: "Einheitlicher Posteingang",
    metaTitle: "Einheitlicher Posteingang — Tamanor",
    summary:
      "Tamanor führt Kommentare und Bewertungen von verbundenen Konten in einem Posteingang zusammen, sodass Teams Risiken plattformübergreifend in einer einzigen Ansicht sichten.",
    keywords: ["einheitlicher posteingang", "social-media-posteingang", "plattformübergreifende moderation"],
    sections: [
      {
        heading: "Eine Ansicht über alle Konten",
        body: [
          "Überwachte Elemente aus jedem verbundenen Konto erscheinen in einem gemeinsamen Posteingang mit Risikokontext, sodass die Sichtung nicht über Plattform-Tabs verstreut ist.",
        ],
      },
    ],
    faqs: [{ q: "Kann ich über den Posteingang antworten?", a: "Der Posteingang dient der Sichtung und Freigabe; Tamanor postet keine Antworten in Ihrem Namen." }],
  },
  "ai-risk-detection": {
    title: "KI-Risikoerkennung",
    metaTitle: "KI-Risikoerkennung — Tamanor",
    summary:
      "Tamanor klassifiziert jeden Kommentar und jede Bewertung mit einer Hybride aus Markenregeln und KI-Analyse und erzeugt eine Risikostufe, Kategorien und Stimmung, die zur Priorisierung und für Vorschläge genutzt werden.",
    keywords: ["ki-risikoerkennung", "inhaltsklassifizierung", "erkennung von spam und betrug", "erkennung von belästigung"],
    sections: [
      {
        heading: "Regeln plus KI",
        body: [
          "Deterministische Markenregeln erfassen bekannte Muster; die KI-Analyse bewältigt Nuancen und Sprache. Zusammen erzeugen sie die Risikosignale, die steuern, was ein Mensch sieht und was vorgeschlagen wird.",
        ],
      },
    ],
    faqs: [{ q: "Trifft die KI die endgültige Entscheidung?", a: "Nein — die KI informiert Priorisierung und Vorschläge; ein Mensch entscheidet." }],
  },
  "facebook": {
    title: "Facebook-Seiten-Integration",
    metaTitle: "Facebook-Integration — Tamanor Kommentarschutz",
    summary:
      "Tamanor verbindet Facebook-Seiten über offizielles OAuth, um Kommentare zu überwachen, Risiken zu erkennen und schädliche Kommentare nach menschlicher Freigabe auszublenden — die einzige heute aktive Moderationsmaßnahme.",
    keywords: ["moderation von facebook-seiten", "facebook-kommentare ausblenden", "überwachung von facebook-kommentaren", "meta oauth"],
    sections: [
      {
        heading: "Was Tamanor mit Facebook macht",
        body: [
          "Tamanor liest Kommentare zu Seiten und Beiträgen, klassifiziert sie und kann einen Kommentar ausblenden, nachdem ein Mensch ihn freigegeben hat. Der ausgeblendete Zustand kann verifiziert werden. Tamanor löscht, antwortet, liked, sperrt oder meldet niemals.",
        ],
      },
    ],
    faqs: [
      { q: "Kann Tamanor Facebook-Kommentare ausblenden?", a: "Ja, nach menschlicher Freigabe. Dies ist die einzige Live-Moderationsmaßnahme, die Tamanor heute ausführt." },
      { q: "Löscht Tamanor oder antwortet es auf Facebook?", a: "Nein. Tamanor blendet nur aus (nach Freigabe) und überwacht ansonsten." },
    ],
  },
  "instagram": {
    title: "Instagram-Integration",
    metaTitle: "Instagram-Integration — Tamanor (Verifizierung ausstehend)",
    summary:
      "Der Instagram-Professional-Connector von Tamanor ist implementierungsfertig — Erkennung über die verknüpfte Facebook-Seite, schreibgeschützte Kommentarerfassung mit Paginierung und Webhooks. Die echte Anbieterverifizierung über Meta App Review steht aus, daher ist er noch nicht live.",
    keywords: ["moderation von instagram business", "überwachung von instagram-kommentaren", "instagram professional oauth"],
    sections: [
      {
        heading: "Was Tamanor mit Instagram macht",
        body: [
          "Der Instagram-Connector erkennt ein verbundenes Instagram-Professional-Konto über dessen Facebook-Seite und liest dessen Kommentare — Kommentare zu Medien und Antworten, mit Paginierung und Webhooks nahezu in Echtzeit. Er ist schreibgeschützt: kein Ausblenden, Löschen, Antworten, Sperren oder Melden.",
          "Status: Implementierung abgeschlossen, echte Anbieterverifizierung ausstehend. Der Live-Einsatz erfordert Meta App Review; bis dahin präsentiert Tamanor Instagram nicht als live.",
        ],
      },
    ],
    faqs: [
      { q: "Ist Instagram heute live?", a: "Nein. Der Instagram-Connector ist implementierungsfertig, aber noch nicht live — die echte Anbieterverifizierung über Meta App Review steht aus." },
      { q: "Kann Tamanor Instagram-Kommentare ausblenden?", a: "Nein. Instagram ist schreibgeschützt; es ist keine Moderationsmaßnahme aktiviert." },
      { q: "Wie wird Instagram verbunden?", a: "Über die verknüpfte Facebook-Seite mittels offiziellem OAuth — die beiden verhalten sich als ein einheitlicher Connector." },
    ],
  },
  "google-business": {
    title: "Google-Business-Integration",
    metaTitle: "Google-Business-Integration — Tamanor (Verifizierung ausstehend)",
    summary:
      "Der Google-Business-Profile-Connector von Tamanor ist eine Grundlage, die für genehmigten API-Zugriff bereit ist — er liest Rezensent, Bewertung und Text. Die echte Anbieterverifizierung steht aus, daher ist die Bewertungsüberwachung noch nicht live.",
    keywords: ["google business bewertungen", "bewertungsüberwachung", "google business profile api"],
    sections: [
      {
        heading: "Was Tamanor mit Google Business macht",
        body: [
          "Der Google-Business-Connector liest Standortbewertungen (Rezensent, Sternebewertung, Bewertungstext) in die Reputation ein. Er antwortet nicht automatisch auf Bewertungen.",
          "Status: Connector-Implementierung/Grundlage bereit für genehmigten API-Zugriff; echte Anbieterverifizierung ausstehend. Die Bewertungsüberwachung ist noch nicht live und wird auch nicht als solche dargestellt.",
        ],
      },
    ],
    faqs: [
      { q: "Ist die Überwachung von Google-Business-Bewertungen live?", a: "Nein. Der Connector ist eine Grundlage, die für genehmigten API-Zugriff bereit ist; die echte Anbieterverifizierung steht aus." },
      { q: "Antwortet Tamanor auf Google-Bewertungen?", a: "Nein — Bewertungsantworten sind nicht automatisiert." },
    ],
  },
  "youtube": {
    title: "YouTube-Integration (geplant)",
    metaTitle: "YouTube-Integration (geplant) — Tamanor",
    summary:
      "Ein YouTube-Connector ist geplant. Tamanor beansprucht noch keine YouTube-Unterstützung; die Kommentarüberwachung wird erst aktiviert, sobald sie erstellt und verifiziert ist.",
    keywords: ["überwachung von youtube-kommentaren", "youtube-moderation", "geplante integration"],
    sections: [
      {
        heading: "Geplant, noch nicht beansprucht",
        body: [
          "YouTube stellt Kommentar-Threads über seine offizielle API bereit. Eine Connector-Grundlage existiert im Code, aber Tamanor bewirbt keine YouTube-Unterstützung, solange die Lese-Synchronisierung nicht implementiert und verifiziert ist.",
        ],
      },
    ],
    faqs: [{ q: "Kann ich YouTube heute überwachen?", a: "Noch nicht — YouTube ist geplant und wird nicht als unterstützt beansprucht." }],
  },
  "linkedin": {
    title: "LinkedIn-Integration (geplant)",
    metaTitle: "LinkedIn-Integration (geplant) — Tamanor",
    summary:
      "Ein Connector für LinkedIn-Unternehmensseiten ist geplant. Der API-Zugriff von LinkedIn auf organische Kommentare ist partner-beschränkt, daher bewirbt Tamanor keine LinkedIn-Fähigkeiten, solange der Zugriff nicht verifiziert ist.",
    keywords: ["linkedin unternehmensseite", "linkedin-moderation", "geplante integration"],
    sections: [
      {
        heading: "Ehrlich in Bezug auf eingeschränkten Zugriff",
        body: [
          "LinkedIn schränkt den Zugriff auf organische Kommentare stark ein. Solange dieser Zugriff nicht gewährt und verifiziert ist, beansprucht Tamanor keine LinkedIn-Fähigkeit.",
        ],
      },
    ],
    faqs: [{ q: "Unterstützt Tamanor LinkedIn?", a: "Noch nicht — es ist geplant und der Zugriff ist partner-beschränkt." }],
  },
  "tiktok": {
    title: "TikTok-Integration (geplant)",
    metaTitle: "TikTok-Integration (geplant) — Tamanor",
    summary:
      "Ein TikTok-Connector ist geplant. Das Lesen/Moderieren von Kommentaren über die offizielle API ist app-review-beschränkt, daher bewirbt Tamanor keine TikTok-Fähigkeiten, solange sie nicht nachgewiesen sind.",
    keywords: ["tiktok kommentarmoderation", "tiktok business api", "geplante integration"],
    sections: [
      {
        heading: "Geplant, durch Prüfung beschränkt",
        body: [
          "Die offizielle Kommentar-API von TikTok ist eingeschränkt und app-review-beschränkt. Tamanor sagt ehrlich, dass TikTok geplant und noch nicht unterstützt ist.",
        ],
      },
    ],
    faqs: [{ q: "Unterstützt Tamanor TikTok?", a: "Noch nicht — es ist geplant und app-review-beschränkt." }],
  },
  "getting-started": {
    title: "Erste Schritte",
    metaTitle: "Erste Schritte — Tamanor-Dokumentation",
    summary:
      "Verbinden Sie eine Facebook-Seite oder ein Instagram-Professional-Konto über offizielles OAuth, lassen Sie Tamanor Kommentare überwachen und geben Sie vorgeschlagene Maßnahmen aus der Warteschlange frei.",
    keywords: ["erste schritte", "tamanor einrichtung", "social-media-konto verbinden"],
    sections: [
      {
        heading: "Drei Schritte",
        body: [
          "1) Verbinden Sie ein Konto über offizielles OAuth. 2) Tamanor beginnt mit der Überwachung und Klassifizierung von Kommentaren. 3) Prüfen Sie vorgeschlagene Maßnahmen in der Freigabe-Warteschlange und geben Sie sie frei oder lehnen Sie sie ab.",
        ],
      },
    ],
    faqs: [{ q: "Brauche ich ein Passwort?", a: "Nein — Sie verbinden sich über offizielles OAuth, niemals über ein Passwort." }],
  },
  "connect-facebook": {
    title: "Eine Facebook-Seite verbinden",
    metaTitle: "Facebook verbinden — Tamanor-Dokumentation",
    summary:
      "Verbinden Sie eine Facebook-Seite über das offizielle OAuth von Meta, damit Tamanor Kommentare überwachen und schädliche nach Freigabe ausblenden kann.",
    keywords: ["facebook verbinden", "facebook oauth", "einrichtung der facebook-seite"],
    sections: [
      {
        heading: "Über OAuth verbinden",
        body: [
          "Starten Sie die Verbindung, erteilen Sie die angeforderten Berechtigungen bei Meta, und Tamanor speichert nur das OAuth-Token (in der Produktion verschlüsselt). Tamanor erkennt dann Ihre Seite und beginnt mit der schreibgeschützten Überwachung.",
        ],
      },
    ],
    faqs: [{ q: "Welche Berechtigungen werden benötigt?", a: "Die Seiten-Berechtigungen, die zum Lesen von Kommentaren und — für das Ausblenden — zum Verwalten der Interaktion erforderlich sind — angefordert über das OAuth von Meta." }],
  },
  "connect-instagram": {
    title: "Ein Instagram-Konto verbinden",
    metaTitle: "Instagram verbinden — Tamanor-Dokumentation",
    summary:
      "Verbinden Sie ein Instagram-Professional-Konto über dessen verknüpfte Facebook-Seite mittels offiziellem OAuth, damit Tamanor dessen Kommentare überwachen kann (schreibgeschützt).",
    keywords: ["instagram verbinden", "instagram professional", "instagram oauth"],
    sections: [
      {
        heading: "Verbunden über die Facebook-Seite",
        body: [
          "Tamanor erkennt während des OAuth das Instagram-Professional-Konto, das mit Ihrer Facebook-Seite verknüpft ist. Die Seite und Instagram verhalten sich als ein einheitlicher Connector, und die Instagram-Überwachung ist schreibgeschützt.",
        ],
      },
    ],
    faqs: [{ q: "Verbinde ich Instagram separat?", a: "Nein — es wird über die verknüpfte Facebook-Seite erkannt." }],
  },
  "roles-and-permissions": {
    title: "Rollen & Berechtigungen",
    metaTitle: "Rollen & Berechtigungen — Tamanor-Dokumentation",
    summary:
      "Verstehen Sie die Arbeitsbereichsrollen von Tamanor und wie Plattformberechtigung plus Rollenberechtigung gemeinsam entscheiden, welche Maßnahmen verfügbar sind.",
    keywords: ["rollen und berechtigungen", "rbac-dokumentation", "arbeitsbereichsrollen"],
    sections: [
      {
        heading: "Zwei Berechtigungsebenen",
        body: [
          "Die Plattformberechtigung (was die OAuth-Freigabe erlaubt) und die Arbeitsbereichsrolle (was Ihre Rolle erlaubt) müssen beide eine Maßnahme zulassen, bevor sie angeboten wird. Freigaben sind auf autorisierte Rollen beschränkt.",
        ],
      },
    ],
    faqs: [{ q: "Kann ich einschränken, wer Maßnahmen freigibt?", a: "Ja — die Freigabe ist auf Rollen beschränkt, denen Sie sie gewähren." }],
  },
  "webhooks": {
    title: "Webhooks",
    metaTitle: "Webhooks — Tamanor-Dokumentation",
    summary:
      "Tamanor verifiziert Webhook-Signaturen, dedupliziert Zustellungen, leitet Facebook- und Instagram-Ereignisse über einen Connector und löst den Mandanten aus dem verbundenen Konto auf.",
    keywords: ["webhooks dokumentation", "webhook-signatur", "meta webhooks", "instagram webhooks"],
    sections: [
      {
        heading: "Signiert, dedupliziert, mandantensicher",
        body: [
          "Jedes eingehende Ereignis wird signaturverifiziert; nur gültige Ereignisse werden verarbeitet. Ein Dedup-Schlüssel weist Wiederholungen ab. Der Mandant wird stets aus dem zugeordneten Konto abgeleitet, niemals aus der Nutzlast.",
        ],
      },
    ],
    faqs: [{ q: "Werden unsignierte Webhooks verarbeitet?", a: "Nein — sie werden für das Audit gespeichert, aber niemals verarbeitet." }],
  },
  "security-overview": {
    title: "Sicherheitsübersicht",
    metaTitle: "Sicherheitsübersicht — Tamanor-Dokumentation",
    summary:
      "Ein prägnanter technischer Überblick über die Sicherheitsausrichtung von Tamanor: nur OAuth, standardmäßig schreibgeschützt, verschlüsselte Tokens, mandantengetrennte Isolation auf Zeilenebene und ein ausschließlich anfügendes Audit-Log.",
    keywords: ["sicherheitsübersicht", "sicherheitsdokumentation", "oauth-sicherheit", "rls"],
    sections: [
      {
        heading: "Das Wesentliche",
        body: [
          "Nur offizielles OAuth; kein Scraping; keine Passwörter. Tokens im Ruhezustand verschlüsselt und aus Logs herausgehalten. Sicherheit auf Zeilenebene isoliert Mandanten. Jede Maßnahme wird protokolliert. Standardmäßig schreibgeschützt mit menschlich freigegebenen Maßnahmen.",
        ],
      },
    ],
    faqs: [{ q: "Wo befindet sich die vollständige Sicherheitsseite?", a: "Die öffentliche Sicherheitsseite fasst Vertrauen und Sicherheit zusammen; diese Dokumentation ist das technische Begleitstück." }],
  },
  "manual-moderation": {
    title: "Tamanor vs. manuelle Moderation",
    metaTitle: "Tamanor vs. manuelle Moderation — Ansatzvergleich",
    summary:
      "Wie sich eine zentralisierte, protokollierte, regelkonsistente Firewall mit dem händischen Prüfen jeder Plattform vergleicht. Ein Workflow-Vergleich — es werden keine numerischen Zeitersparnisse behauptet.",
    keywords: ["manuelle moderation", "workflow der social-media-moderation", "zentralisierter posteingang", "audit-trail"],
    sections: [
      {
        heading: "Was sich ändert",
        body: [
          "Manuelle Moderation bedeutet, jede Plattform zu öffnen und Kommentare von Hand zu lesen: Die Abdeckung hängt davon ab, wer wann beobachtet, Regeln stecken in den Köpfen der Menschen, und es gibt keine einheitliche Aufzeichnung darüber, was entschieden wurde.",
          "Tamanor zentralisiert überwachte Kommentare und Bewertungen an einem Ort, wendet dieselben Markenregeln und die KI-Risikoerkennung auf jedes Element an und erfasst jede Maßnahme in einem ausschließlich anfügenden Audit-Log — sodass Entscheidungen konsistent und nachprüfbar sind statt willkürlich.",
        ],
      },
      {
        heading: "Ehrliche Grenzen",
        body: [
          "Tamanor behält weiterhin einen Menschen in der Schleife: Es bereitet Vorschläge vor und eine Person gibt sie frei. Es behauptet nicht, den Prüfaufwand zu eliminieren oder zu garantieren, dass nie etwas übersehen wird — es macht die Abdeckung systematisch und nachprüfbar. Es wird kein bestimmter Prozentsatz an eingesparter Zeit behauptet, da dies von Ihrem Volumen abhängt.",
        ],
      },
    ],
    faqs: [
      { q: "Ersetzt Tamanor menschliche Prüfer?", a: "Nein. Es zentralisiert und priorisiert die Arbeit; ein Mensch gibt weiterhin jede Maßnahme frei." },
      { q: "Behaupten Sie eine bestimmte Zeitersparnis?", a: "Nein — jede Zahl würde von Ihrem Kommentarvolumen und Team abhängen, daher veröffentlichen wir keine." },
    ],
  },
  "separate-social-tools": {
    title: "Tamanor vs. separate plattformspezifische Tools",
    metaTitle: "Tamanor vs. separate Social-Media-Tools — Ansatzvergleich",
    summary:
      "Wie sich ein anbieterneutrales Modell mit gemeinsamen Risikoregeln und einem Audit mit dem Zusammenstückeln separater plattformspezifischer Oberflächen vergleicht. Ein Workflow-Vergleich.",
    keywords: ["separate social-media-tools", "anbieterneutral", "einheitliche moderation", "plattformübergreifend"],
    sections: [
      {
        heading: "Was sich ändert",
        body: [
          "Eine unterschiedliche Oberfläche pro Plattform zu nutzen, zersplittert Regeln, Risikobewertung und Historie über Tools hinweg. Jedes Tool sieht nur seine eigene Plattform, und was eine Maßnahme bedeutet, unterscheidet sich von einem zum nächsten.",
          "Tamanor normalisiert Kommentare und Bewertungen in ein anbieterneutrales Modell, wendet gemeinsame Risiko- und Stimmungsregeln an und behält ein Audit bei — während es weiterhin die realen Fähigkeiten jedes Anbieters respektiert (eine Maßnahme, die eine Plattform nicht ausführen kann, wird niemals angeboten).",
        ],
      },
    ],
    faqs: [
      { q: "Bedeutet ein Modell, dass sich jede Plattform gleich verhält?", a: "Nein — Tamanor respektiert die realen Fähigkeitsgrenzen jedes Anbieters; das Modell ist einheitlich, die Fähigkeiten sind pro Plattform ehrlich." },
    ],
  },
  "autonomous-ai-moderation": {
    title: "Tamanor vs. autonome KI-Moderation",
    metaTitle: "Mensch in der Schleife vs. autonome KI-Moderation",
    summary:
      "Tamanor hat den Menschen in der Schleife, nicht autonom: Die KI erkennt und schlägt vor, Regeln und Fähigkeits-Gates greifen, und ein Mensch gibt vor jeder Maßnahme frei. Die Ausführung ist fail-closed.",
    keywords: ["autonome ki-moderation", "mensch in der schleife", "freigabe-workflow", "fail-closed"],
    sections: [
      {
        heading: "Der wahre Unterschied",
        body: [
          "Ein vollständig autonomes System entscheidet und handelt von sich aus. Tamanor tut dies bewusst nicht: Die automatische Ausführung ist deaktiviert. Die KI erzeugt eine Risikobewertung und eine vorgeschlagene Maßnahme; Markenregeln, der Freigabe-Workflow, Prüfungen der Plattformfähigkeit und Connector-Zustands-Gates greifen alle; und ein Mensch gibt frei, bevor etwas eine Plattform berührt.",
          "Die Ausführung ist fail-closed — wenn zur Ausführungszeit eine Fähigkeit oder Berechtigung fehlt, scheitert die Maßnahme sicher und wird protokolliert, anstatt erzwungen zu werden. Tamanor ist kein — und wird auch nicht als solcher präsentiert — vollständig autonomer Moderator.",
        ],
      },
    ],
    faqs: [
      { q: "Kann ich vollautomatisches Ausblenden aktivieren?", a: "Nein. Die automatische Ausführung ist bewusst nicht verfügbar; Vorschläge werden zur menschlichen Freigabe vorbereitet." },
      { q: "Ist Tamanor ein autonomer KI-Agent?", a: "Nein. Es hat konstruktionsbedingt den Menschen in der Schleife; autoExecution ist deaktiviert." },
    ],
  },
  "unified-brand-inbox": {
    title: "Tamanor vs. separate Facebook-/Instagram-/Google-Oberflächen",
    metaTitle: "Einheitlicher Marken-Posteingang vs. separate Anbieteroberflächen",
    summary:
      "Wie sich ein normalisierter Posteingang für Kommentare und Bewertungen mit separaten Anbieteroberflächen vergleicht — mit ehrlichen anbieterspezifischen Fähigkeitsgrenzen und wahrheitsgetreuen Connector-Zuständen.",
    keywords: ["einheitlicher marken-posteingang", "social-media-posteingang", "kommentare vs. bewertungen", "connector-status"],
    sections: [
      {
        heading: "Was sich ändert",
        body: [
          "Separate Anbieteroberflächen bedeuten Kontextwechsel zwischen Facebook, Instagram und Google, jede mit ihrer eigenen Ansicht von Kommentaren oder Bewertungen. Tamanor bringt überwachte Elemente in einen normalisierten Posteingang mit gemeinsamem Risikokontext und unterscheidet dabei Kommentare von Bewertungen.",
          "Die Verfügbarkeit ist ehrlich: Jeder Anbieter zeigt seinen realen Connector-Zustand, und nur Facebook ist heute live-verifiziert. Instagram und Google Business erscheinen mit ihrem wahren Status (Verifizierung ausstehend), niemals als live.",
        ],
      },
    ],
    faqs: [
      { q: "Sind alle Anbieter im Posteingang live?", a: "Nein. Facebook ist live-verifiziert; Instagram und Google Business werden mit ihrem wahren Status „Verifizierung ausstehend“ angezeigt." },
    ],
  },
  "reputation-management-platform-checklist": {
    title: "Checkliste für Reputationsmanagement-Plattformen",
    metaTitle: "Checkliste für Reputationsplattformen — neutrale Bewertung",
    summary:
      "Eine neutrale Käufer-Checkliste zur Bewertung jeder Reputations-/Moderationsplattform, mit dem ehrlichen Status von Tamanor pro Punkt — einschließlich dessen, was noch nicht umgesetzt ist.",
    keywords: ["checkliste für reputationsmanagement", "bewertungskriterien", "käufer-checkliste", "moderationsplattform"],
    sections: [
      {
        heading: "So verwenden Sie dies",
        body: [
          "Dies sind anbieterneutrale Kriterien zur Bewertung jeder Plattform. Jede Zeile nennt den ehrlichen Status von Tamanor; wo etwas noch nicht umgesetzt ist, sagt es dies, statt Vollständigkeit anzudeuten.",
        ],
      },
      {
        heading: "Sicherheit & Daten",
        body: [
          "Mandantentrennung — ja: PostgreSQL-Sicherheit auf Zeilenebene isoliert jeden Mandanten auf Datenbankebene.",
          "Audit — ja: ausschließlich anfügendes, mandantenbezogenes Audit-Log ohne Geheimnisse.",
          "Token-Verschlüsselung — ja: OAuth-Tokens im Ruhezustand in der Produktion verschlüsselt; Klartext-Speicherung in der Produktion blockiert.",
          "Berechtigungs-Gates — ja: Plattformfähigkeit und Arbeitsbereichsrolle müssen beide eine Maßnahme zulassen.",
          "Dateneigentum — ja: die Daten eines Kunden sind pro Mandant isoliert und werden nicht geteilt oder verkauft.",
          "Schlüsselrotation — noch nicht: die Rotation des Token-Verschlüsselungsschlüssels bleibt eine Lücke in der Roadmap.",
          "Export-/Aufbewahrungssteuerung — noch nicht: Self-Service-Export und Aufbewahrungsrichtlinien sind nicht implementiert.",
        ],
      },
      {
        heading: "Workflow & Betrieb",
        body: [
          "Freigabe-Workflow — ja: menschliche Freigabe vor jeder Maßnahme; fail-closed-Ausführung.",
          "Anbieterzustand — ja: ehrliche Zustands-/Berechtigungsstatus der Connectors, kein vorgetäuschtes Grün.",
          "Trennungslebenszyklus — ja: das Trennen entfernt lokale Tokens; der Widerruf beim Anbieter erfolgt nach bestem Bemühen.",
          "Workflow-Persistenz — ja: Vorschläge, Freigaben und Ergebnisse bleiben erhalten und sind nachprüfbar.",
          "Paginierung / Skalierbarkeit — ja: Lese-Synchronisierungen paginieren mit Cursorn und sind idempotent.",
          "Anbieterverifizierung — teilweise: Facebook ist live-verifiziert; Instagram und Google Business sind Verifizierung ausstehend; YouTube/LinkedIn/TikTok sind Recherche.",
        ],
      },
    ],
    faqs: [
      { q: "Erfüllt Tamanor jeden Punkt?", a: "Nein — Schlüsselrotation und Export/Aufbewahrung sind ausdrücklich noch nicht umgesetzt, und mehrere Anbieter sind Verifizierung ausstehend. Die Checkliste nennt jeden Punkt ehrlich." },
    ],
  },
  "tenant-isolation": {
    title: "Mandantentrennung",
    metaTitle: "Mandantentrennung — Tamanor-Sicherheit",
    summary:
      "Tamanor beschränkt jede Sitzung und Abfrage auf einen aktiven Mandanten, legt Anwendungsberechtigungsprüfungen über die Datenbank-Sicherheit auf Zeilenebene und hält System- und Laufzeit-Datenbankzugriff getrennt.",
    keywords: ["mandantentrennung", "mandantenfähige sicherheit", "aktiver mandant", "laufzeit-rls"],
    sections: [
      {
        heading: "Ein aktiver Mandant, zweifach erzwungen",
        body: [
          "Sitzungen sind mandantenbezogen: Eine Anfrage trägt genau einen aktiven Mandanten. Anwendungsberechtigungsprüfungen entscheiden, was ein Mitglied tun darf, und die PostgreSQL-Sicherheit auf Zeilenebene erzwingt, welche Zeilen für diesen Mandanten auf der Datenbankebene existieren.",
          "Mandantenübergreifende Systemarbeit (Worker-Erkennung, Bereinigung) nutzt einen separaten, engen Zugriffspfad, der niemals bei einer normalen Mandantenanfrage verwendet wird. Der Laufzeit-Mandanten-Client und der System-Client sind konstruktionsbedingt getrennt.",
        ],
      },
    ],
    faqs: [{ q: "Kann ein Kunde die Daten eines anderen sehen?", a: "Nein. Die Isolation wird durch die Sicherheit auf Zeilenebene auf der Datenbankebene erzwungen, nicht nur durch den Anwendungscode." }],
  },
  "authentication": {
    title: "Authentifizierung & Sitzungen",
    metaTitle: "Authentifizierung — Tamanor Sitzungen",
    summary:
      "Tamanor verwendet undurchsichtige Sitzungen, wobei das Token in der Datenbank gehasht wird, und unterstützt Widerruf, Ablauf und Invalidierung beim Abmelden.",
    keywords: ["authentifizierung", "undurchsichtige sitzung", "sitzungswiderruf", "abmelden"],
    sections: [
      {
        heading: "Undurchsichtige, widerrufbare Sitzungen",
        body: [
          "Eine Sitzung ist ein undurchsichtiges Token; die Datenbank speichert nur dessen Hash, niemals das Roh-Token. Sitzungen laufen ab, können widerrufen werden und werden beim Abmelden invalidiert. Serverseitige Prüfungen erzwingen die Authentifizierung bei jeder geschützten Route und Maßnahme.",
        ],
      },
    ],
    faqs: [{ q: "Wird das Roh-Sitzungstoken gespeichert?", a: "Nein — es wird nur ein Hash gespeichert, sodass die Datenbank niemals das nutzbare Token hält." }],
  },
  "provider-tokens": {
    title: "Anbieter-Tokens",
    metaTitle: "Anbieter-Tokens — Tamanor Token-Sicherheit",
    summary:
      "OAuth-Anbieter-Tokens werden im Ruhezustand verschlüsselt, beim Trennen lokal entfernt und beim Anbieter nach bestem Bemühen widerrufen; die Schlüsselrotation ist eine verbleibende Lücke in der Roadmap.",
    keywords: ["anbieter-tokens", "sicherheit von oauth-tokens", "verschlüsselung im ruhezustand", "token-widerruf"],
    sections: [
      {
        heading: "Wie Tokens gehandhabt werden",
        body: [
          "OAuth-Tokens werden in der Produktion im Ruhezustand verschlüsselt und niemals angezeigt, protokolliert oder in den Audit-Trail aufgenommen. Das Trennen eines Kontos entfernt das gespeicherte Token lokal; der Widerruf beim Anbieter wird nach bestem Bemühen versucht.",
          "Ehrliche Lücke: Die automatisierte Schlüsselrotation für die Token-Verschlüsselung ist noch nicht implementiert und verbleibt auf der Roadmap.",
        ],
      },
    ],
    faqs: [{ q: "Ist die Schlüsselrotation implementiert?", a: "Noch nicht — die Verschlüsselung im Ruhezustand ist vorhanden, aber die automatisierte Schlüsselrotation ist eine verbleibende Lücke in der Roadmap." }],
  },
  "audit-logging": {
    title: "Audit-Protokollierung",
    metaTitle: "Audit-Protokollierung — Tamanor-Sicherheit",
    summary:
      "Tamanor schreibt ein ausschließlich anfügendes, mandantenbezogenes Audit-Log; Akteursreferenzen verwenden einen SetNull-Lebenszyklus, sodass die Historie das Entfernen eines Nutzers überdauert, und Tokens werden niemals protokolliert.",
    keywords: ["audit-protokollierung", "ausschließlich anfügend", "akteurslebenszyklus", "keine token-protokollierung"],
    sections: [
      {
        heading: "Ausschließlich anfügend, ohne Geheimnisse",
        body: [
          "Bedeutsame Maßnahmen werden ausschließlich anfügend und auf den Mandanten beschränkt erfasst. Akteursreferenzen verwenden einen SetNull-Lebenszyklus, sodass das Entfernen eines Nutzers die historische Aufzeichnung nicht löscht. Kein Token, Passwort oder Verbindungsstring erscheint jemals in einem Audit-Eintrag.",
        ],
      },
    ],
    faqs: [{ q: "Enthalten Audit-Einträge jemals Tokens?", a: "Nein — Geheimnisse werden bereinigt; das Audit-Log enthält niemals Token-Material." }],
  },
  "data-integrity": {
    title: "Datenintegrität",
    metaTitle: "Datenintegrität — Tamanor-Sicherheit",
    summary:
      "Tamanor speichert Inhalte und Reputation atomar, erfasst idempotent, verwendet kontobezogene Sperren und erzwingt referenzielle Integrität, um verwaiste Datensätze zu verhindern.",
    keywords: ["datenintegrität", "atomares schreiben", "idempotente erfassung", "referenzielle integrität"],
    sections: [
      {
        heading: "Konsistent durch Konstruktion",
        body: [
          "Jeder Inhalt und sein Reputationsdatensatz werden in einer atomaren Transaktion geschrieben. Die Erfassung ist idempotent, sodass dasselbe Element niemals dupliziert wird. Eine kontobezogene Sperre verhindert überlappende Synchronisierungen, und die referenzielle Integrität verhindert verwaiste Datensätze.",
        ],
      },
    ],
    faqs: [{ q: "Kann eine Synchronisierung Duplikate erzeugen?", a: "Nein — die Erfassung ist auf einem eindeutigen Schlüssel idempotent, sodass die erneute Verarbeitung eines Elements es dedupliziert." }],
  },
  "webhook-security": {
    title: "Webhook-Sicherheit",
    metaTitle: "Webhook-Sicherheit — Tamanor",
    summary:
      "Tamanor verifiziert Webhook-Signaturen, dedupliziert Wiederholungen, leitet den Mandanten aus dem verbundenen Konto ab (niemals aus der Nutzlast) und speichert ungültige Webhooks nur für das Audit — ohne sie jemals zu verarbeiten.",
    keywords: ["webhook-sicherheit", "signaturverifizierung", "wiederholungsschutz", "mandantenableitung"],
    sections: [
      {
        heading: "Vertrauenswürdig durch Konstruktion",
        body: [
          "Eingehende Webhooks werden signaturverifiziert; nur gültige Ereignisse werden verarbeitet. Ein stabiler Dedup-Schlüssel weist Wiederholungen ab. Der Mandant wird aus dem zugeordneten verbundenen Konto abgeleitet, niemals aus der Nutzlast, sodass ein manipulierter Rumpf keine Mandanten überschreiten kann. Ungültige oder unsignierte Ereignisse werden für das Audit gespeichert, aber niemals verarbeitet.",
        ],
      },
    ],
    faqs: [{ q: "Wird auf unsignierte Webhooks reagiert?", a: "Nein — sie werden nur für das Audit gespeichert und niemals verarbeitet." }],
  },
  "responsible-ai": {
    title: "Verantwortungsvolle KI",
    metaTitle: "Verantwortungsvolle KI — Tamanor",
    summary:
      "Die KI von Tamanor hat den Menschen in der Schleife: Sie erkennt und schlägt unter Markenregeln und Anbieter-Fähigkeits-Gates vor, mit einem Freigabeschritt und fail-closed-Ausführung — niemals uneingeschränkte Autonomie.",
    keywords: ["verantwortungsvolle ki", "mensch in der schleife", "ki-governance", "fähigkeits-gates"],
    sections: [
      {
        heading: "Die KI schlägt vor, Menschen entscheiden",
        body: [
          "Die KI erzeugt ausschließlich Risikobewertungen und Vorschläge. Markenregeln, der Freigabe-Workflow und Anbieter-Fähigkeits-Gates greifen alle, und die Ausführung ist fail-closed. Die automatische Ausführung ist deaktiviert; Tamanor ist kein uneingeschränkter autonomer Agent.",
        ],
      },
    ],
    faqs: [{ q: "Handelt die KI von sich aus?", a: "Nein — sie schlägt vor; ein Mensch gibt frei, und die Ausführung ist fähigkeitsgesteuert und fail-closed." }],
  },
  "disclosure": {
    title: "Sicherheitsoffenlegung",
    metaTitle: "Sicherheitsoffenlegung — Tamanor",
    summary:
      "Wie Sie ein Sicherheitsbedenken an Tamanor melden. Meldungen erreichen das Team über den Kontaktkanal; eine dedizierte Sicherheitsadresse ist vor der Produktion konfigurierbar.",
    keywords: ["sicherheitsoffenlegung", "verantwortungsvolle offenlegung", "schwachstelle melden", "sicherheitskontakt"],
    sections: [
      {
        heading: "Ein Bedenken melden",
        body: [
          "Wenn Sie glauben, ein Sicherheitsproblem gefunden zu haben, wenden Sie sich bitte über die Kontaktseite an das Team. Wir bitten Meldende, den Zugriff auf oder die Änderung der Daten anderer Nutzer zu vermeiden und uns eine angemessene Gelegenheit zur Reaktion zu geben, bevor sie es öffentlich offenlegen.",
          "Ein dediziertes Sicherheitspostfach ist vor der Produktion konfigurierbar; bis es angekündigt wird, ist der Kontaktkanal der maßgebliche Weg. Tamanor veröffentlicht keine Platzhalteradresse, die nicht überwacht wird.",
        ],
      },
    ],
    faqs: [
      { q: "Wo melde ich eine Schwachstelle?", a: "Verwenden Sie die Kontaktseite. Eine dedizierte Sicherheitsadresse ist vor der Produktion konfigurierbar und wird bekannt gegeben, sobald sie live ist." },
    ],
  },
};
