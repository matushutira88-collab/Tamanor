// Localized legal content — GDPR Privacy Policy and Cookie Policy (en/sk/de).
//
// This is early-product wording provided for transparency and is not legal
// advice. The operating legal entity is Infotech Solutions, s. r. o. Have the
// final text reviewed by counsel before general availability.
//
// Factual basis (kept in sync with the product):
//   • Auth session cookie:   `tamanor_session`  — httpOnly, SameSite=Lax,
//                            Secure in production, 7-day lifetime.
//   • Language cookie:       `guardora_locale`  — stores UI language (en/sk/de).
//   • No advertising, cross-site tracking or third-party analytics cookies.
//   • Read-only by default; official OAuth/API only; no scraping; no social
//     passwords; access tokens are encrypted and never logged or displayed.
//   • The AI Risk Engine proposes actions; sensitive actions require human
//     approval (human-in-the-loop) — no solely-automated decisions with legal
//     or similarly significant effect on data subjects.

import type { Locale } from "@/i18n";

export type LegalBlock =
  | { type: "p"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

export interface LegalSection {
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  /** e.g. "Last updated: 14 July 2026" — already localized. */
  updated: string;
  sections: LegalSection[];
}

const UPDATED = {
  en: "Last updated: 14 July 2026",
  sk: "Naposledy aktualizované: 14. júla 2026",
  de: "Zuletzt aktualisiert: 14. Juli 2026",
} as const;

/* ────────────────────────────────────────────────────────────────────────
 * PRIVACY POLICY
 * ──────────────────────────────────────────────────────────────────────── */

const privacyEn: LegalDoc = {
  metaTitle: "Privacy Policy — Tamanor",
  metaDescription:
    "How Tamanor processes personal data under the GDPR: what we collect, why, the legal bases, who we share it with, retention, and your rights.",
  eyebrow: "Legal",
  title: "Privacy Policy",
  subtitle:
    "How Tamanor processes personal data under the GDPR — what we collect, why, the legal bases, and the rights you have.",
  updated: UPDATED.en,
  sections: [
    {
      title: "1. Who we are",
      blocks: [
        {
          type: "p",
          text: "Tamanor is a Social Account Firewall: a multi-tenant SaaS that helps brands monitor comments, reviews and audience feedback across connected social platforms, detect reputational risk, and apply moderation with human oversight and a complete audit trail. \"Tamanor\", \"we\", \"us\" and \"our\" refer to the company operating the Tamanor service.",
        },
        {
          type: "p",
          text: "Data controller: Infotech Solutions, s. r. o., Konopná 194/23, 027 44 Tvrdošín, Slovakia. Company ID (IČO): 56 660 308, Tax ID (DIČ): 2122380810, VAT ID (IČ DPH): SK2122380810. For any privacy question or to exercise your rights, contact us at info@tamanor.com or +421 901 724 290.",
        },
        {
          type: "p",
          text: "Note on naming: our public brand is Tamanor, operated by Infotech Solutions, s. r. o. Some internal package names, database tables and technical identifiers still use the earlier name \"guardora\". This is a transitional artefact and does not affect how your data is handled.",
        },
      ],
    },
    {
      title: "2. Scope of this policy",
      blocks: [
        {
          type: "p",
          text: "This policy explains how we handle personal data in connection with our public website, our SaaS dashboard, and the background processing that keeps connected accounts in sync. It applies to visitors of our site, to the people at customer organisations who use Tamanor, and to individuals whose public content (for example, a comment or review) is processed through the platforms our customers connect.",
        },
      ],
    },
    {
      title: "3. Our two roles: controller and processor",
      blocks: [
        {
          type: "p",
          text: "We act as a data controller for the personal data of our own users and prospects — for example account details, billing information, and how the product is used. For this data, we decide the purposes and means of processing and this policy governs it.",
        },
        {
          type: "p",
          text: "We act as a data processor for the platform content our customers choose to bring into Tamanor (for example public comments and reviews, and the authorship metadata the platforms provide). Here our customer is the controller, we process on their documented instructions, and a Data Processing Agreement governs that relationship. If your content was processed because a brand connected its own account, that brand is your first point of contact; we will support any request they pass to us.",
        },
      ],
    },
    {
      title: "4. Personal data we process",
      blocks: [
        {
          type: "p",
          text: "Depending on how you interact with Tamanor, we process the following categories of personal data:",
        },
        {
          type: "bullets",
          items: [
            "Account & identity data — name, work email, password hash, workspace/tenant and role, and language and interface preferences.",
            "Customer & billing data — organisation name, plan, trial status, usage counters, and billing contact details (payment card data is handled by our payment provider, not stored by us).",
            "Connected-platform content — public comments, reviews, posts and mentions retrieved via official platform APIs from accounts our customers connect, together with the authorship metadata the platform provides (for example a display name, public profile identifier and timestamps).",
            "Moderation & decision data — the risk classification, sentiment/topic signals, proposed actions, approvals, and the moderation state your team creates inside Tamanor.",
            "Audit & security data — an append-only record of automated and manual actions, plus sign-in events and session information needed to secure the service.",
            "Technical data — IP address, device/browser information, and server logs generated when you use the site or dashboard.",
            "Communications — messages you send us via contact forms, demo requests or email, and their contents.",
          ],
        },
        {
          type: "p",
          text: "We do not ask for or store your social-platform passwords, we do not scrape any platform, and access tokens obtained through OAuth are encrypted and are never displayed or written to logs. We do not seek to collect special categories of personal data; where such data appears incidentally inside public content, it is processed only as part of the moderation the customer has asked us to perform.",
        },
      ],
    },
    {
      title: "5. Where the data comes from",
      blocks: [
        {
          type: "bullets",
          items: [
            "Directly from you — when you create an account, request a demo, contact us, or use the product.",
            "From connected platforms — through official OAuth/API integrations that a customer authorises for accounts they are entitled to manage (for example Facebook Pages, Instagram Business, YouTube, Google Business Profile).",
            "Automatically — technical and usage data generated as you interact with the site and dashboard.",
          ],
        },
      ],
    },
    {
      title: "6. Why we process data and our legal bases",
      blocks: [
        {
          type: "p",
          text: "We rely on the following legal bases under Article 6(1) GDPR:",
        },
        {
          type: "table",
          headers: ["Purpose", "Legal basis"],
          rows: [
            ["Providing the service, managing your account, and syncing connected platforms", "Performance of a contract (Art. 6(1)(b))"],
            ["Detecting reputational risk, preparing proposed actions for review, and keeping an audit trail", "Legitimate interests in operating and securing the service and helping customers protect their brand (Art. 6(1)(f)); for platform content, on the customer's instructions as processor"],
            ["Securing the service, preventing abuse, and troubleshooting", "Legitimate interests (Art. 6(1)(f))"],
            ["Billing, tax and accounting records", "Legal obligation (Art. 6(1)(c)) and performance of a contract (Art. 6(1)(b))"],
            ["Product-related communications and responding to your enquiries", "Legitimate interests / performance of a contract (Art. 6(1)(b) and (f))"],
            ["Optional analytics or marketing where offered", "Consent (Art. 6(1)(a)), which you may withdraw at any time"],
          ],
        },
        {
          type: "p",
          text: "Where we rely on legitimate interests, we balance those interests against your rights and freedoms and only proceed where they are not overridden. You can ask us for more detail about this balancing at any time.",
        },
      ],
    },
    {
      title: "7. Automated processing and the AI Risk Engine",
      blocks: [
        {
          type: "p",
          text: "Tamanor uses an AI Risk Engine to classify content and suggest actions such as flagging or hiding a public comment. These are decision-support signals: sensitive actions are gated behind human approval, and the product is read-only by default. We do not make decisions producing legal or similarly significant effects about you solely by automated means without human involvement. Every automated and manual action is recorded in the audit log so it can be reviewed.",
        },
      ],
    },
    {
      title: "8. Who we share data with",
      blocks: [
        {
          type: "p",
          text: "We do not sell your personal data. We share it only with the recipients needed to run the service:",
        },
        {
          type: "bullets",
          items: [
            "Social platform providers — Meta (Facebook/Instagram), Google (YouTube, Google Business Profile) and similar, via their official APIs, strictly to read the content and perform the moderation you enable.",
            "Infrastructure & hosting providers — who host the application and database under contract and on our instructions.",
            "AI processing providers — used by the Risk Engine to classify content, under contract and without using your data to train third-party models where avoidable.",
            "Professional advisers and authorities — where we are legally required to disclose, or to establish, exercise or defend legal claims.",
            "Successors — in the event of a merger, acquisition or reorganisation, subject to this policy.",
          ],
        },
        {
          type: "p",
          text: "All processors act under a written agreement (Art. 28 GDPR) that limits them to processing on our instructions. A current list of sub-processors is available on request at info@tamanor.com.",
        },
      ],
    },
    {
      title: "9. International transfers",
      blocks: [
        {
          type: "p",
          text: "Some recipients may process data outside the European Economic Area. Where they do, we rely on an adequacy decision or on appropriate safeguards such as the European Commission's Standard Contractual Clauses, together with supplementary measures where needed. You can request a copy of the relevant safeguards using the contact details below.",
        },
      ],
    },
    {
      title: "10. How long we keep data",
      blocks: [
        {
          type: "bullets",
          items: [
            "Account and workspace data — for as long as your account is active, then deleted or anonymised within a reasonable period after closure.",
            "Connected-platform content and moderation state — retained per the customer's configuration and instructions; disconnecting a platform stops further syncing for that account.",
            "Audit records — retained for a period appropriate to their security and accountability purpose.",
            "Billing and tax records — retained for the period required by applicable law.",
            "Technical logs — retained for a short operational period, then rotated.",
          ],
        },
        {
          type: "p",
          text: "Data export, deletion and retention controls are being finalised and will be fully documented before general availability. You can already request deletion using the contact details below.",
        },
      ],
    },
    {
      title: "11. How we protect data",
      blocks: [
        {
          type: "p",
          text: "We apply technical and organisational measures appropriate to the risk, including encryption of OAuth tokens at rest, strict tenant isolation so each workspace only sees its own data, least-privilege access, fail-closed defaults for sensitive actions, and an append-only audit log. Access tokens and secrets are never logged or shown in the interface.",
        },
      ],
    },
    {
      title: "12. Your rights",
      blocks: [
        {
          type: "p",
          text: "Subject to conditions in the GDPR, you have the right to:",
        },
        {
          type: "bullets",
          items: [
            "Access — obtain confirmation of, and a copy of, the personal data we hold about you.",
            "Rectification — have inaccurate or incomplete data corrected.",
            "Erasure — ask us to delete your data (the \"right to be forgotten\").",
            "Restriction — ask us to limit processing in certain circumstances.",
            "Portability — receive certain data in a structured, commonly used, machine-readable format.",
            "Objection — object to processing based on legitimate interests, and to direct marketing at any time.",
            "Withdraw consent — where processing is based on consent, withdraw it at any time without affecting prior processing.",
            "Not be subject to solely-automated decisions with legal or similarly significant effect.",
          ],
        },
        {
          type: "p",
          text: "To exercise any right, email info@tamanor.com. Where your content was processed because a brand connected its account, we may direct your request to that customer as the controller. You also have the right to lodge a complaint with a supervisory authority — in Slovakia, the Office for Personal Data Protection of the Slovak Republic (Úrad na ochranu osobných údajov Slovenskej republiky) — or with the authority in your country of residence.",
        },
      ],
    },
    {
      title: "13. Cookies",
      blocks: [
        {
          type: "p",
          text: "We use a small number of cookies that are strictly necessary to run the service (for sign-in sessions and your language preference). We do not use advertising or cross-site tracking cookies. See our Cookie Policy for the full list and how to manage them.",
        },
      ],
    },
    {
      title: "14. Children",
      blocks: [
        {
          type: "p",
          text: "Tamanor is a business tool and is not directed at children. We do not knowingly create accounts for anyone under 16. Public content processed on a customer's behalf may occasionally originate from minors on the connected platform; such content is processed only for the moderation the customer has configured.",
        },
      ],
    },
    {
      title: "15. Changes to this policy",
      blocks: [
        {
          type: "p",
          text: "We may update this policy as the product evolves or as the law requires. We will change the \"last updated\" date above and, for material changes, provide reasonable notice. The current version is always available on this page.",
        },
      ],
    },
    {
      title: "16. Contact us",
      blocks: [
        {
          type: "p",
          text: "Questions about privacy or your data? Email info@tamanor.com, call +421 901 724 290, or write to Infotech Solutions, s. r. o., Konopná 194/23, 027 44 Tvrdošín, Slovakia. We aim to respond within the timeframe required by the GDPR (normally one month).",
        },
      ],
    },
  ],
};

const privacySk: LegalDoc = {
  metaTitle: "Zásady ochrany osobných údajov — Tamanor",
  metaDescription:
    "Ako Tamanor spracúva osobné údaje podľa GDPR: čo zbierame, prečo, na akom právnom základe, komu údaje sprístupňujeme, ako dlho ich uchovávame a aké máte práva.",
  eyebrow: "Právne informácie",
  title: "Zásady ochrany osobných údajov",
  subtitle:
    "Ako Tamanor spracúva osobné údaje podľa GDPR — čo zbierame, prečo, na akom právnom základe a aké práva máte.",
  updated: UPDATED.sk,
  sections: [
    {
      title: "1. Kto sme",
      blocks: [
        {
          type: "p",
          text: "Tamanor je „Social Account Firewall“: multi-tenant SaaS, ktorý pomáha značkám monitorovať komentáre, recenzie a spätnú väzbu publika naprieč pripojenými sociálnymi platformami, odhaľovať reputačné riziko a uplatňovať moderovanie s ľudským dohľadom a úplným auditným záznamom. Pojmy „Tamanor“, „my“ a „naše“ označujú spoločnosť prevádzkujúcu službu Tamanor.",
        },
        {
          type: "p",
          text: "Prevádzkovateľ: Infotech Solutions, s. r. o., Konopná 194/23, 027 44 Tvrdošín, Slovensko. IČO: 56 660 308, DIČ: 2122380810, IČ DPH: SK2122380810. V akejkoľvek otázke ochrany súkromia alebo na uplatnenie svojich práv nás kontaktujte na info@tamanor.com alebo +421 901 724 290.",
        },
        {
          type: "p",
          text: "Poznámka k názvu: naša verejná značka je Tamanor, ktorú prevádzkuje Infotech Solutions, s. r. o. Niektoré interné názvy balíkov, databázové tabuľky a technické identifikátory stále používajú skorší názov „guardora“. Ide o prechodný stav, ktorý nemá vplyv na spôsob nakladania s vašimi údajmi.",
        },
      ],
    },
    {
      title: "2. Rozsah týchto zásad",
      blocks: [
        {
          type: "p",
          text: "Tieto zásady vysvetľujú, ako nakladáme s osobnými údajmi v súvislosti s naším verejným webom, so SaaS nástrojom (dashboardom) a s procesmi na pozadí, ktoré udržiavajú pripojené účty synchronizované. Vzťahujú sa na návštevníkov webu, na osoby v zákazníckych organizáciách, ktoré Tamanor používajú, a na fyzické osoby, ktorých verejný obsah (napríklad komentár alebo recenzia) sa spracúva prostredníctvom platforiem pripojených našimi zákazníkmi.",
        },
      ],
    },
    {
      title: "3. Naše dve úlohy: prevádzkovateľ a sprostredkovateľ",
      blocks: [
        {
          type: "p",
          text: "Vo vzťahu k osobným údajom našich vlastných používateľov a záujemcov vystupujeme ako prevádzkovateľ — napríklad údaje o účte, fakturačné údaje a spôsob používania produktu. Pre tieto údaje určujeme účely a prostriedky spracúvania a riadia sa týmito zásadami.",
        },
        {
          type: "p",
          text: "Vo vzťahu k obsahu z platforiem, ktorý naši zákazníci vložia do Tamanoru (napríklad verejné komentáre a recenzie a metaúdaje o autorstve poskytnuté platformami), vystupujeme ako sprostredkovateľ. Prevádzkovateľom je tu náš zákazník, my spracúvame na základe jeho zdokumentovaných pokynov a tento vzťah upravuje zmluva o spracúvaní údajov (DPA). Ak bol váš obsah spracovaný preto, že si značka pripojila vlastný účet, táto značka je vaším prvým kontaktným miestom; každú žiadosť, ktorú nám postúpi, podporíme.",
        },
      ],
    },
    {
      title: "4. Aké osobné údaje spracúvame",
      blocks: [
        {
          type: "p",
          text: "V závislosti od toho, ako s Tamanorom interagujete, spracúvame tieto kategórie osobných údajov:",
        },
        {
          type: "bullets",
          items: [
            "Údaje o účte a identite — meno, pracovný e-mail, hash hesla, workspace/tenant a rola, jazykové a rozhranie preferencie.",
            "Zákaznícke a fakturačné údaje — názov organizácie, plán, stav skúšobnej verzie, počítadlá využitia a fakturačné kontaktné údaje (údaje o platobnej karte spracúva náš poskytovateľ platieb, my ich neukladáme).",
            "Obsah z pripojených platforiem — verejné komentáre, recenzie, príspevky a zmienky získané cez oficiálne API platforiem z účtov, ktoré naši zákazníci pripoja, spolu s metaúdajmi o autorstve poskytnutými platformou (napríklad zobrazované meno, verejný identifikátor profilu a časové značky).",
            "Údaje o moderovaní a rozhodnutiach — klasifikácia rizika, signály sentimentu/tém, navrhované akcie, schválenia a stav moderovania, ktorý váš tím vytvorí v Tamanore.",
            "Auditné a bezpečnostné údaje — záznam iba na pridávanie (append-only) o automatických a manuálnych akciách, plus udalosti prihlásenia a informácie o relácii potrebné na zabezpečenie služby.",
            "Technické údaje — IP adresa, informácie o zariadení/prehliadači a serverové logy vznikajúce pri používaní webu alebo dashboardu.",
            "Komunikácia — správy, ktoré nám pošlete cez kontaktné formuláre, žiadosti o demo alebo e-mail, a ich obsah.",
          ],
        },
        {
          type: "p",
          text: "Nepýtame si ani neukladáme vaše heslá k sociálnym platformám, žiadnu platformu nesťahujeme (no scraping) a prístupové tokeny získané cez OAuth sú šifrované a nikdy sa nezobrazujú ani nezapisujú do logov. Osobitné kategórie osobných údajov cielene nezbierame; ak sa takéto údaje náhodne objavia vo verejnom obsahu, spracúvajú sa len ako súčasť moderovania, o ktoré zákazník požiadal.",
        },
      ],
    },
    {
      title: "5. Odkiaľ údaje pochádzajú",
      blocks: [
        {
          type: "bullets",
          items: [
            "Priamo od vás — pri vytvorení účtu, žiadosti o demo, kontaktovaní nás alebo pri používaní produktu.",
            "Z pripojených platforiem — cez oficiálne OAuth/API integrácie, ktoré zákazník autorizuje pre účty, ktoré je oprávnený spravovať (napríklad Facebook stránky, Instagram Business, YouTube, Google Business Profile).",
            "Automaticky — technické a prevádzkové údaje vznikajúce pri interakcii s webom a dashboardom.",
          ],
        },
      ],
    },
    {
      title: "6. Prečo údaje spracúvame a naše právne základy",
      blocks: [
        {
          type: "p",
          text: "Opierame sa o tieto právne základy podľa článku 6 ods. 1 GDPR:",
        },
        {
          type: "table",
          headers: ["Účel", "Právny základ"],
          rows: [
            ["Poskytovanie služby, správa vášho účtu a synchronizácia pripojených platforiem", "Plnenie zmluvy (čl. 6 ods. 1 písm. b))"],
            ["Odhaľovanie reputačného rizika, príprava navrhovaných akcií na posúdenie a vedenie auditného záznamu", "Oprávnený záujem na prevádzke a zabezpečení služby a pomoci zákazníkom chrániť značku (čl. 6 ods. 1 písm. f)); pri obsahu z platforiem na pokyn zákazníka ako sprostredkovateľ"],
            ["Zabezpečenie služby, prevencia zneužitia a riešenie problémov", "Oprávnený záujem (čl. 6 ods. 1 písm. f))"],
            ["Fakturácia, daňové a účtovné záznamy", "Zákonná povinnosť (čl. 6 ods. 1 písm. c)) a plnenie zmluvy (čl. 6 ods. 1 písm. b))"],
            ["Komunikácia súvisiaca s produktom a odpovede na vaše otázky", "Oprávnený záujem / plnenie zmluvy (čl. 6 ods. 1 písm. b) a f))"],
            ["Voliteľná analytika alebo marketing, ak sú ponúkané", "Súhlas (čl. 6 ods. 1 písm. a)), ktorý môžete kedykoľvek odvolať"],
          ],
        },
        {
          type: "p",
          text: "Keď sa opierame o oprávnený záujem, vyvažujeme ho voči vašim právam a slobodám a postupujeme tak len vtedy, ak nad ním neprevažujú. O bližšie informácie k tomuto vyvažovaniu nás môžete kedykoľvek požiadať.",
        },
      ],
    },
    {
      title: "7. Automatizované spracúvanie a AI Risk Engine",
      blocks: [
        {
          type: "p",
          text: "Tamanor používa AI Risk Engine na klasifikáciu obsahu a navrhovanie akcií, ako je označenie alebo skrytie verejného komentára. Ide o signály na podporu rozhodovania: citlivé akcie sú podmienené ľudským schválením a produkt je štandardne určený len na čítanie (read-only). Nerobíme rozhodnutia s právnymi alebo podobne významnými účinkami na vás výlučne automatizovanými prostriedkami bez ľudského zásahu. Každá automatická aj manuálna akcia sa zaznamenáva do auditného logu, aby ju bolo možné preskúmať.",
        },
      ],
    },
    {
      title: "8. Komu údaje sprístupňujeme",
      blocks: [
        {
          type: "p",
          text: "Vaše osobné údaje nepredávame. Sprístupňujeme ich len príjemcom potrebným na prevádzku služby:",
        },
        {
          type: "bullets",
          items: [
            "Poskytovatelia sociálnych platforiem — Meta (Facebook/Instagram), Google (YouTube, Google Business Profile) a podobne, cez ich oficiálne API, výlučne na čítanie obsahu a vykonanie moderovania, ktoré povolíte.",
            "Poskytovatelia infraštruktúry a hostingu — ktorí hostia aplikáciu a databázu na základe zmluvy a našich pokynov.",
            "Poskytovatelia AI spracúvania — využívaní Risk Engine na klasifikáciu obsahu, na základe zmluvy a bez využívania vašich údajov na trénovanie modelov tretích strán, kde je to možné.",
            "Odborní poradcovia a orgány — ak sme zo zákona povinní sprístupniť údaje alebo na uplatnenie, výkon či obhajobu právnych nárokov.",
            "Právni nástupcovia — v prípade zlúčenia, akvizície alebo reorganizácie, v súlade s týmito zásadami.",
          ],
        },
        {
          type: "p",
          text: "Všetci sprostredkovatelia konajú na základe písomnej zmluvy (čl. 28 GDPR), ktorá ich obmedzuje na spracúvanie podľa našich pokynov. Aktuálny zoznam sub-sprostredkovateľov poskytneme na požiadanie na info@tamanor.com.",
        },
      ],
    },
    {
      title: "9. Medzinárodné prenosy",
      blocks: [
        {
          type: "p",
          text: "Niektorí príjemcovia môžu spracúvať údaje mimo Európskeho hospodárskeho priestoru. V takom prípade sa opierame o rozhodnutie o primeranosti alebo o vhodné záruky, ako sú štandardné zmluvné doložky Európskej komisie, spolu s doplnkovými opatreniami, ak sú potrebné. Kópiu príslušných záruk si môžete vyžiadať na nižšie uvedených kontaktoch.",
        },
      ],
    },
    {
      title: "10. Ako dlho údaje uchovávame",
      blocks: [
        {
          type: "bullets",
          items: [
            "Údaje o účte a workspace — po dobu, kým je váš účet aktívny, potom vymazané alebo anonymizované v primeranej lehote po zrušení.",
            "Obsah z pripojených platforiem a stav moderovania — uchovávané podľa konfigurácie a pokynov zákazníka; odpojenie platformy zastaví ďalšiu synchronizáciu daného účtu.",
            "Auditné záznamy — uchovávané po dobu primeranú ich bezpečnostnému účelu a účelu zodpovednosti.",
            "Fakturačné a daňové záznamy — uchovávané po dobu vyžadovanú platnými právnymi predpismi.",
            "Technické logy — uchovávané krátku prevádzkovú dobu, potom rotované.",
          ],
        },
        {
          type: "p",
          text: "Nástroje na export, mazanie a nastavenie retencie sa dokončujú a budú plne zdokumentované pred všeobecnou dostupnosťou. O vymazanie už teraz môžete požiadať na nižšie uvedených kontaktoch.",
        },
      ],
    },
    {
      title: "11. Ako údaje chránime",
      blocks: [
        {
          type: "p",
          text: "Uplatňujeme technické a organizačné opatrenia primerané riziku vrátane šifrovania OAuth tokenov v pokoji, prísnej izolácie tenantov, aby každý workspace videl len svoje údaje, prístupu s minimálnymi oprávneniami, štandardne uzavretých (fail-closed) nastavení pre citlivé akcie a auditného logu iba na pridávanie. Prístupové tokeny a tajomstvá sa nikdy nelogujú ani nezobrazujú v rozhraní.",
        },
      ],
    },
    {
      title: "12. Vaše práva",
      blocks: [
        {
          type: "p",
          text: "Za podmienok stanovených v GDPR máte právo na:",
        },
        {
          type: "bullets",
          items: [
            "Prístup — získať potvrdenie a kópiu osobných údajov, ktoré o vás vedieme.",
            "Opravu — nechať opraviť nesprávne alebo neúplné údaje.",
            "Vymazanie — požiadať nás o vymazanie vašich údajov („právo na zabudnutie“).",
            "Obmedzenie — požiadať o obmedzenie spracúvania za určitých okolností.",
            "Prenosnosť — získať určité údaje v štruktúrovanom, bežne používanom a strojovo čitateľnom formáte.",
            "Namietanie — namietať proti spracúvaniu na základe oprávneného záujmu a proti priamemu marketingu kedykoľvek.",
            "Odvolanie súhlasu — ak je spracúvanie založené na súhlase, kedykoľvek ho odvolať bez vplyvu na predchádzajúce spracúvanie.",
            "Nebyť predmetom výlučne automatizovaného rozhodnutia s právnym alebo podobne významným účinkom.",
          ],
        },
        {
          type: "p",
          text: "Na uplatnenie ktoréhokoľvek práva napíšte na info@tamanor.com. Ak bol váš obsah spracovaný preto, že si značka pripojila svoj účet, môžeme vašu žiadosť postúpiť tomuto zákazníkovi ako prevádzkovateľovi. Máte tiež právo podať sťažnosť dozornému orgánu — na Slovensku Úradu na ochranu osobných údajov Slovenskej republiky — alebo orgánu v krajine vášho pobytu.",
        },
      ],
    },
    {
      title: "13. Cookies",
      blocks: [
        {
          type: "p",
          text: "Používame malý počet cookies, ktoré sú nevyhnutne potrebné na prevádzku služby (na prihlasovacie relácie a vašu jazykovú preferenciu). Nepoužívame reklamné ani sledovacie cookies naprieč stránkami. Úplný zoznam a možnosti správy nájdete v našich Zásadách používania cookies.",
        },
      ],
    },
    {
      title: "14. Deti",
      blocks: [
        {
          type: "p",
          text: "Tamanor je nástroj pre podnikanie a nie je určený deťom. Vedome nevytvárame účty osobám mladším ako 16 rokov. Verejný obsah spracúvaný v mene zákazníka môže občas pochádzať od maloletých na pripojenej platforme; takýto obsah sa spracúva len na účely moderovania, ktoré zákazník nastavil.",
        },
      ],
    },
    {
      title: "15. Zmeny týchto zásad",
      blocks: [
        {
          type: "p",
          text: "Tieto zásady môžeme aktualizovať, ako sa produkt vyvíja alebo ako to vyžaduje právo. Zmeníme dátum „naposledy aktualizované“ vyššie a pri podstatných zmenách poskytneme primerané upozornenie. Aktuálna verzia je vždy dostupná na tejto stránke.",
        },
      ],
    },
    {
      title: "16. Kontaktujte nás",
      blocks: [
        {
          type: "p",
          text: "Otázky k ochrane súkromia alebo vašim údajom? Napíšte na info@tamanor.com, volajte +421 901 724 290 alebo píšte na adresu Infotech Solutions, s. r. o., Konopná 194/23, 027 44 Tvrdošín, Slovensko. Odpovedať sa snažíme v lehote požadovanej GDPR (spravidla jeden mesiac).",
        },
      ],
    },
  ],
};

const privacyDe: LegalDoc = {
  metaTitle: "Datenschutzerklärung — Tamanor",
  metaDescription:
    "Wie Tamanor personenbezogene Daten nach der DSGVO verarbeitet: was wir erheben, warum, auf welcher Rechtsgrundlage, an wen wir weitergeben, Speicherdauer und Ihre Rechte.",
  eyebrow: "Rechtliches",
  title: "Datenschutzerklärung",
  subtitle:
    "Wie Tamanor personenbezogene Daten nach der DSGVO verarbeitet — was wir erheben, warum, auf welcher Rechtsgrundlage und welche Rechte Sie haben.",
  updated: UPDATED.de,
  sections: [
    {
      title: "1. Wer wir sind",
      blocks: [
        {
          type: "p",
          text: "Tamanor ist eine „Social Account Firewall“: eine mandantenfähige SaaS-Lösung, die Marken hilft, Kommentare, Bewertungen und Publikums-Feedback über verbundene soziale Plattformen hinweg zu überwachen, Reputationsrisiken zu erkennen und Moderation mit menschlicher Aufsicht und einem vollständigen Prüfprotokoll umzusetzen. „Tamanor“, „wir“ und „uns“ bezeichnen das Unternehmen, das den Tamanor-Dienst betreibt.",
        },
        {
          type: "p",
          text: "Verantwortlicher: Infotech Solutions, s. r. o., Konopná 194/23, 027 44 Tvrdošín, Slowakei. Unternehmens-ID (IČO): 56 660 308, Steuer-ID (DIČ): 2122380810, USt-IdNr. (IČ DPH): SK2122380810. Bei Fragen zum Datenschutz oder zur Ausübung Ihrer Rechte erreichen Sie uns unter info@tamanor.com oder +421 901 724 290.",
        },
        {
          type: "p",
          text: "Hinweis zum Namen: Unsere öffentliche Marke ist Tamanor, betrieben von Infotech Solutions, s. r. o. Einige interne Paketnamen, Datenbanktabellen und technische Bezeichner verwenden noch den früheren Namen „guardora“. Dies ist ein Übergangsartefakt und hat keinen Einfluss darauf, wie mit Ihren Daten umgegangen wird.",
        },
      ],
    },
    {
      title: "2. Geltungsbereich",
      blocks: [
        {
          type: "p",
          text: "Diese Erklärung beschreibt, wie wir personenbezogene Daten im Zusammenhang mit unserer öffentlichen Website, unserem SaaS-Dashboard und der Hintergrundverarbeitung, die verbundene Konten synchron hält, behandeln. Sie gilt für Besucher unserer Website, für die Personen in Kundenorganisationen, die Tamanor nutzen, und für Personen, deren öffentliche Inhalte (zum Beispiel ein Kommentar oder eine Bewertung) über die von unseren Kunden verbundenen Plattformen verarbeitet werden.",
        },
      ],
    },
    {
      title: "3. Unsere zwei Rollen: Verantwortlicher und Auftragsverarbeiter",
      blocks: [
        {
          type: "p",
          text: "Für die personenbezogenen Daten unserer eigenen Nutzer und Interessenten handeln wir als Verantwortlicher — etwa Kontodaten, Rechnungsdaten und die Nutzung des Produkts. Für diese Daten bestimmen wir Zwecke und Mittel der Verarbeitung, und diese Erklärung gilt dafür.",
        },
        {
          type: "p",
          text: "Für die Plattforminhalte, die unsere Kunden in Tamanor einbringen (zum Beispiel öffentliche Kommentare und Bewertungen sowie die von den Plattformen bereitgestellten Urhebermetadaten), handeln wir als Auftragsverarbeiter. Hier ist unser Kunde der Verantwortliche, wir verarbeiten auf seine dokumentierten Weisungen, und ein Auftragsverarbeitungsvertrag (AVV) regelt dieses Verhältnis. Wurde Ihr Inhalt verarbeitet, weil eine Marke ihr eigenes Konto verbunden hat, ist diese Marke Ihre erste Anlaufstelle; jede Anfrage, die sie an uns weiterleitet, unterstützen wir.",
        },
      ],
    },
    {
      title: "4. Welche personenbezogenen Daten wir verarbeiten",
      blocks: [
        {
          type: "p",
          text: "Je nachdem, wie Sie mit Tamanor interagieren, verarbeiten wir folgende Kategorien personenbezogener Daten:",
        },
        {
          type: "bullets",
          items: [
            "Konto- und Identitätsdaten — Name, geschäftliche E-Mail-Adresse, Passwort-Hash, Workspace/Mandant und Rolle sowie Sprach- und Oberflächeneinstellungen.",
            "Kunden- und Abrechnungsdaten — Organisationsname, Tarif, Teststatus, Nutzungszähler und Rechnungskontaktdaten (Zahlungskartendaten werden von unserem Zahlungsdienstleister verarbeitet und nicht von uns gespeichert).",
            "Inhalte verbundener Plattformen — öffentliche Kommentare, Bewertungen, Beiträge und Erwähnungen, die über offizielle Plattform-APIs aus von unseren Kunden verbundenen Konten abgerufen werden, samt der von der Plattform bereitgestellten Urhebermetadaten (z. B. Anzeigename, öffentliche Profilkennung und Zeitstempel).",
            "Moderations- und Entscheidungsdaten — Risikoklassifizierung, Stimmungs-/Themensignale, vorgeschlagene Maßnahmen, Freigaben und der Moderationsstatus, den Ihr Team in Tamanor erstellt.",
            "Prüf- und Sicherheitsdaten — ein nur anfügbares (append-only) Protokoll automatischer und manueller Maßnahmen sowie Anmelde-Ereignisse und Sitzungsinformationen, die zur Absicherung des Dienstes erforderlich sind.",
            "Technische Daten — IP-Adresse, Geräte-/Browserinformationen und Serverprotokolle, die bei der Nutzung der Website oder des Dashboards entstehen.",
            "Kommunikation — Nachrichten, die Sie uns über Kontaktformulare, Demo-Anfragen oder E-Mail senden, sowie deren Inhalte.",
          ],
        },
        {
          type: "p",
          text: "Wir fragen Ihre Social-Media-Passwörter nicht ab und speichern sie nicht, wir betreiben kein Scraping und über OAuth erlangte Zugriffstokens sind verschlüsselt und werden niemals angezeigt oder protokolliert. Besondere Kategorien personenbezogener Daten erheben wir nicht gezielt; erscheinen solche Daten beiläufig in öffentlichen Inhalten, werden sie nur im Rahmen der vom Kunden beauftragten Moderation verarbeitet.",
        },
      ],
    },
    {
      title: "5. Woher die Daten stammen",
      blocks: [
        {
          type: "bullets",
          items: [
            "Direkt von Ihnen — wenn Sie ein Konto erstellen, eine Demo anfragen, uns kontaktieren oder das Produkt nutzen.",
            "Von verbundenen Plattformen — über offizielle OAuth/API-Integrationen, die ein Kunde für Konten autorisiert, die er verwalten darf (z. B. Facebook-Seiten, Instagram Business, YouTube, Google Business Profile).",
            "Automatisch — technische und Nutzungsdaten, die bei der Interaktion mit Website und Dashboard entstehen.",
          ],
        },
      ],
    },
    {
      title: "6. Warum wir Daten verarbeiten und unsere Rechtsgrundlagen",
      blocks: [
        {
          type: "p",
          text: "Wir stützen uns auf folgende Rechtsgrundlagen nach Art. 6 Abs. 1 DSGVO:",
        },
        {
          type: "table",
          headers: ["Zweck", "Rechtsgrundlage"],
          rows: [
            ["Bereitstellung des Dienstes, Verwaltung Ihres Kontos und Synchronisierung verbundener Plattformen", "Vertragserfüllung (Art. 6 Abs. 1 lit. b)"],
            ["Erkennung von Reputationsrisiken, Vorbereitung vorgeschlagener Maßnahmen zur Prüfung und Führung eines Prüfprotokolls", "Berechtigtes Interesse am Betrieb und der Absicherung des Dienstes und daran, Kunden beim Markenschutz zu helfen (Art. 6 Abs. 1 lit. f); für Plattforminhalte als Auftragsverarbeiter auf Weisung des Kunden"],
            ["Absicherung des Dienstes, Missbrauchsprävention und Fehlerbehebung", "Berechtigtes Interesse (Art. 6 Abs. 1 lit. f)"],
            ["Abrechnung, Steuer- und Buchhaltungsunterlagen", "Rechtliche Verpflichtung (Art. 6 Abs. 1 lit. c) und Vertragserfüllung (Art. 6 Abs. 1 lit. b)"],
            ["Produktbezogene Kommunikation und Beantwortung Ihrer Anfragen", "Berechtigtes Interesse / Vertragserfüllung (Art. 6 Abs. 1 lit. b und f)"],
            ["Optionale Analyse oder Marketing, soweit angeboten", "Einwilligung (Art. 6 Abs. 1 lit. a), die Sie jederzeit widerrufen können"],
          ],
        },
        {
          type: "p",
          text: "Soweit wir uns auf berechtigte Interessen stützen, wägen wir diese gegen Ihre Rechte und Freiheiten ab und verarbeiten nur, wenn diese nicht überwiegen. Nähere Angaben zu dieser Abwägung können Sie jederzeit anfordern.",
        },
      ],
    },
    {
      title: "7. Automatisierte Verarbeitung und die KI-Risiko-Engine",
      blocks: [
        {
          type: "p",
          text: "Tamanor verwendet eine KI-Risiko-Engine, um Inhalte zu klassifizieren und Maßnahmen wie das Markieren oder Ausblenden eines öffentlichen Kommentars vorzuschlagen. Dies sind entscheidungsunterstützende Signale: sensible Maßnahmen erfordern eine menschliche Freigabe, und das Produkt ist standardmäßig nur lesend (read-only). Wir treffen keine Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung Ihnen gegenüber ausschließlich automatisiert ohne menschliche Beteiligung. Jede automatische und manuelle Maßnahme wird im Prüfprotokoll erfasst und ist überprüfbar.",
        },
      ],
    },
    {
      title: "8. An wen wir Daten weitergeben",
      blocks: [
        {
          type: "p",
          text: "Wir verkaufen Ihre personenbezogenen Daten nicht. Wir geben sie nur an die für den Betrieb des Dienstes erforderlichen Empfänger weiter:",
        },
        {
          type: "bullets",
          items: [
            "Betreiber sozialer Plattformen — Meta (Facebook/Instagram), Google (YouTube, Google Business Profile) und ähnliche, über deren offizielle APIs, ausschließlich zum Lesen der Inhalte und zur Durchführung der von Ihnen aktivierten Moderation.",
            "Infrastruktur- und Hosting-Anbieter — die die Anwendung und die Datenbank vertraglich und auf unsere Weisung hosten.",
            "KI-Verarbeitungsanbieter — von der Risiko-Engine zur Inhaltsklassifizierung genutzt, vertraglich gebunden und ohne Nutzung Ihrer Daten zum Training von Drittmodellen, soweit vermeidbar.",
            "Berufliche Berater und Behörden — soweit wir rechtlich zur Offenlegung verpflichtet sind oder zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen.",
            "Rechtsnachfolger — im Falle einer Fusion, Übernahme oder Umstrukturierung, vorbehaltlich dieser Erklärung.",
          ],
        },
        {
          type: "p",
          text: "Alle Auftragsverarbeiter handeln auf Grundlage eines schriftlichen Vertrags (Art. 28 DSGVO), der sie auf die Verarbeitung nach unseren Weisungen beschränkt. Eine aktuelle Liste der Unterauftragsverarbeiter ist auf Anfrage unter info@tamanor.com erhältlich.",
        },
      ],
    },
    {
      title: "9. Internationale Datenübermittlungen",
      blocks: [
        {
          type: "p",
          text: "Einige Empfänger verarbeiten Daten möglicherweise außerhalb des Europäischen Wirtschaftsraums. In diesem Fall stützen wir uns auf einen Angemessenheitsbeschluss oder auf geeignete Garantien wie die Standardvertragsklauseln der Europäischen Kommission, gegebenenfalls ergänzt um zusätzliche Maßnahmen. Eine Kopie der einschlägigen Garantien können Sie über die unten genannten Kontaktdaten anfordern.",
        },
      ],
    },
    {
      title: "10. Wie lange wir Daten speichern",
      blocks: [
        {
          type: "bullets",
          items: [
            "Konto- und Workspace-Daten — solange Ihr Konto aktiv ist, danach innerhalb einer angemessenen Frist nach Schließung gelöscht oder anonymisiert.",
            "Inhalte verbundener Plattformen und Moderationsstatus — gemäß Konfiguration und Weisung des Kunden aufbewahrt; das Trennen einer Plattform stoppt die weitere Synchronisierung dieses Kontos.",
            "Prüfprotokolle — für einen Zeitraum aufbewahrt, der ihrem Sicherheits- und Rechenschaftszweck angemessen ist.",
            "Abrechnungs- und Steuerunterlagen — für den gesetzlich vorgeschriebenen Zeitraum aufbewahrt.",
            "Technische Protokolle — für einen kurzen betrieblichen Zeitraum aufbewahrt und dann rotiert.",
          ],
        },
        {
          type: "p",
          text: "Funktionen für Datenexport, Löschung und Aufbewahrungssteuerung werden finalisiert und vor der allgemeinen Verfügbarkeit vollständig dokumentiert. Eine Löschung können Sie bereits jetzt über die unten genannten Kontaktdaten verlangen.",
        },
      ],
    },
    {
      title: "11. Wie wir Daten schützen",
      blocks: [
        {
          type: "p",
          text: "Wir setzen dem Risiko angemessene technische und organisatorische Maßnahmen ein, darunter die Verschlüsselung von OAuth-Tokens im Ruhezustand, strikte Mandantentrennung, sodass jeder Workspace nur seine eigenen Daten sieht, Zugriff nach dem Least-Privilege-Prinzip, standardmäßig geschlossene (fail-closed) Voreinstellungen für sensible Maßnahmen und ein nur anfügbares Prüfprotokoll. Zugriffstokens und Geheimnisse werden niemals protokolliert oder in der Oberfläche angezeigt.",
        },
      ],
    },
    {
      title: "12. Ihre Rechte",
      blocks: [
        {
          type: "p",
          text: "Vorbehaltlich der Voraussetzungen der DSGVO haben Sie das Recht auf:",
        },
        {
          type: "bullets",
          items: [
            "Auskunft — Bestätigung und eine Kopie der über Sie gespeicherten personenbezogenen Daten zu erhalten.",
            "Berichtigung — unrichtige oder unvollständige Daten berichtigen zu lassen.",
            "Löschung — uns aufzufordern, Ihre Daten zu löschen („Recht auf Vergessenwerden“).",
            "Einschränkung — unter bestimmten Umständen eine Einschränkung der Verarbeitung zu verlangen.",
            "Datenübertragbarkeit — bestimmte Daten in einem strukturierten, gängigen und maschinenlesbaren Format zu erhalten.",
            "Widerspruch — der auf berechtigten Interessen beruhenden Verarbeitung sowie jederzeit der Direktwerbung zu widersprechen.",
            "Widerruf der Einwilligung — beruht die Verarbeitung auf Einwilligung, diese jederzeit ohne Auswirkung auf die bisherige Verarbeitung zu widerrufen.",
            "Nicht ausschließlich automatisierten Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung unterworfen zu werden.",
          ],
        },
        {
          type: "p",
          text: "Zur Ausübung eines Rechts schreiben Sie an info@tamanor.com. Wurde Ihr Inhalt verarbeitet, weil eine Marke ihr Konto verbunden hat, leiten wir Ihre Anfrage gegebenenfalls an diesen Kunden als Verantwortlichen weiter. Sie haben außerdem das Recht, Beschwerde bei einer Aufsichtsbehörde einzulegen — in der Slowakei beim Amt für den Schutz personenbezogener Daten der Slowakischen Republik (Úrad na ochranu osobných údajov Slovenskej republiky) — oder bei der Behörde in Ihrem Wohnsitzland.",
        },
      ],
    },
    {
      title: "13. Cookies",
      blocks: [
        {
          type: "p",
          text: "Wir verwenden eine geringe Zahl unbedingt erforderlicher Cookies für den Betrieb des Dienstes (für Anmeldesitzungen und Ihre Spracheinstellung). Wir setzen keine Werbe- oder seitenübergreifenden Tracking-Cookies ein. Die vollständige Liste und die Verwaltungsmöglichkeiten finden Sie in unserer Cookie-Richtlinie.",
        },
      ],
    },
    {
      title: "14. Kinder",
      blocks: [
        {
          type: "p",
          text: "Tamanor ist ein Geschäftswerkzeug und richtet sich nicht an Kinder. Wir erstellen wissentlich keine Konten für Personen unter 16 Jahren. Öffentliche Inhalte, die im Auftrag eines Kunden verarbeitet werden, können gelegentlich von Minderjährigen auf der verbundenen Plattform stammen; solche Inhalte werden nur zu der vom Kunden konfigurierten Moderation verarbeitet.",
        },
      ],
    },
    {
      title: "15. Änderungen dieser Erklärung",
      blocks: [
        {
          type: "p",
          text: "Wir können diese Erklärung anpassen, wenn sich das Produkt weiterentwickelt oder das Recht es verlangt. Wir aktualisieren das Datum „Zuletzt aktualisiert“ oben und weisen bei wesentlichen Änderungen angemessen darauf hin. Die aktuelle Fassung ist stets auf dieser Seite verfügbar.",
        },
      ],
    },
    {
      title: "16. Kontakt",
      blocks: [
        {
          type: "p",
          text: "Fragen zum Datenschutz oder zu Ihren Daten? Schreiben Sie an info@tamanor.com, rufen Sie +421 901 724 290 an oder schreiben Sie an Infotech Solutions, s. r. o., Konopná 194/23, 027 44 Tvrdošín, Slowakei. Wir bemühen uns, innerhalb der von der DSGVO vorgesehenen Frist (in der Regel ein Monat) zu antworten.",
        },
      ],
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────
 * COOKIE POLICY
 * ──────────────────────────────────────────────────────────────────────── */

const cookiesEn: LegalDoc = {
  metaTitle: "Cookie Policy — Tamanor",
  metaDescription:
    "The cookies Tamanor uses, why we use them, and how to manage them. We use only strictly necessary cookies — no advertising or cross-site tracking.",
  eyebrow: "Legal",
  title: "Cookie Policy",
  subtitle:
    "The cookies Tamanor uses, why, and how to manage them. We keep this minimal — no advertising or cross-site tracking.",
  updated: UPDATED.en,
  sections: [
    {
      title: "1. What cookies are",
      blocks: [
        {
          type: "p",
          text: "Cookies are small text files stored on your device when you visit a website. They let a site remember things such as whether you are signed in or which language you prefer. Similar technologies (such as local storage) may be used for the same purposes; where we refer to \"cookies\" we mean these technologies too.",
        },
      ],
    },
    {
      title: "2. How we use cookies",
      blocks: [
        {
          type: "p",
          text: "We keep our use of cookies to a minimum. Tamanor uses only cookies that are strictly necessary to provide the site and dashboard and to remember your language choice. We do not use advertising cookies, and we do not track you across other websites.",
        },
      ],
    },
    {
      title: "3. Cookies we use",
      blocks: [
        {
          type: "table",
          headers: ["Cookie", "Purpose", "Type", "Duration"],
          rows: [
            ["tamanor_session", "Keeps you signed in to the dashboard and secures your session (httpOnly, SameSite=Lax, Secure in production).", "Strictly necessary", "7 days"],
            ["guardora_locale", "Remembers your interface language (English, Slovak or German).", "Strictly necessary / functional", "Up to 1 year"],
          ],
        },
        {
          type: "p",
          text: "We do not load third-party analytics or advertising cookies by default. If we introduce optional analytics in future, we will ask for your consent first and update this policy and the table above.",
        },
      ],
    },
    {
      title: "4. Consent and managing cookies",
      blocks: [
        {
          type: "p",
          text: "Strictly necessary cookies do not require consent because the service cannot function without them. If we ever use non-essential cookies, we will request your consent before setting them, and you will be able to withdraw it at any time.",
        },
        {
          type: "p",
          text: "You can also control cookies through your browser settings — blocking or deleting them. Please note that blocking strictly necessary cookies will prevent you from signing in and may stop parts of the service from working.",
        },
      ],
    },
    {
      title: "5. Third-party cookies",
      blocks: [
        {
          type: "p",
          text: "Connecting a social platform sends you to that platform's official OAuth flow, where the platform (for example Meta or Google) may set its own cookies under its own policies. Those cookies are governed by the respective platform's cookie and privacy policies, not by this one.",
        },
      ],
    },
    {
      title: "6. Changes and contact",
      blocks: [
        {
          type: "p",
          text: "We may update this Cookie Policy as our use of cookies changes; the \"last updated\" date above will reflect this. Questions? Email info@tamanor.com. See also our Privacy Policy for how we handle personal data more generally.",
        },
      ],
    },
  ],
};

const cookiesSk: LegalDoc = {
  metaTitle: "Zásady používania cookies — Tamanor",
  metaDescription:
    "Aké cookies Tamanor používa, prečo a ako ich spravovať. Používame len nevyhnutne potrebné cookies — žiadne reklamné ani sledovacie naprieč stránkami.",
  eyebrow: "Právne informácie",
  title: "Zásady používania cookies",
  subtitle:
    "Aké cookies Tamanor používa, prečo a ako ich spravovať. Držíme to na minime — žiadne reklamné ani sledovacie cookies naprieč stránkami.",
  updated: UPDATED.sk,
  sections: [
    {
      title: "1. Čo sú cookies",
      blocks: [
        {
          type: "p",
          text: "Cookies sú malé textové súbory uložené vo vašom zariadení pri návšteve webu. Umožňujú stránke zapamätať si napríklad to, či ste prihlásení alebo aký jazyk uprednostňujete. Na rovnaké účely sa môžu používať podobné technológie (napríklad lokálne úložisko); ak hovoríme o „cookies“, myslíme tým aj tieto technológie.",
        },
      ],
    },
    {
      title: "2. Ako cookies používame",
      blocks: [
        {
          type: "p",
          text: "Používanie cookies držíme na minime. Tamanor používa len cookies, ktoré sú nevyhnutne potrebné na fungovanie webu a dashboardu a na zapamätanie vášho výberu jazyka. Nepoužívame reklamné cookies a nesledujeme vás naprieč inými webmi.",
        },
      ],
    },
    {
      title: "3. Cookies, ktoré používame",
      blocks: [
        {
          type: "table",
          headers: ["Cookie", "Účel", "Typ", "Trvanie"],
          rows: [
            ["tamanor_session", "Udržiava vás prihláseného v dashboarde a zabezpečuje vašu reláciu (httpOnly, SameSite=Lax, Secure v produkcii).", "Nevyhnutne potrebné", "7 dní"],
            ["guardora_locale", "Zapamätá si jazyk rozhrania (angličtina, slovenčina alebo nemčina).", "Nevyhnutné / funkčné", "Až 1 rok"],
          ],
        },
        {
          type: "p",
          text: "Štandardne nenačítavame analytické ani reklamné cookies tretích strán. Ak v budúcnosti zavedieme voliteľnú analytiku, najprv si vyžiadame váš súhlas a aktualizujeme tieto zásady a tabuľku vyššie.",
        },
      ],
    },
    {
      title: "4. Súhlas a správa cookies",
      blocks: [
        {
          type: "p",
          text: "Nevyhnutne potrebné cookies nevyžadujú súhlas, pretože bez nich služba nemôže fungovať. Ak by sme niekedy použili nepodstatné cookies, pred ich nastavením si vyžiadame váš súhlas a budete ho môcť kedykoľvek odvolať.",
        },
        {
          type: "p",
          text: "Cookies môžete ovládať aj cez nastavenia prehliadača — blokovať alebo mazať ich. Upozorňujeme, že blokovanie nevyhnutne potrebných cookies znemožní prihlásenie a môže zastaviť fungovanie častí služby.",
        },
      ],
    },
    {
      title: "5. Cookies tretích strán",
      blocks: [
        {
          type: "p",
          text: "Pripojenie sociálnej platformy vás presmeruje na oficiálny OAuth proces danej platformy, kde platforma (napríklad Meta alebo Google) môže nastaviť vlastné cookies podľa vlastných pravidiel. Tieto cookies sa riadia zásadami o cookies a ochrane súkromia príslušnej platformy, nie týmito zásadami.",
        },
      ],
    },
    {
      title: "6. Zmeny a kontakt",
      blocks: [
        {
          type: "p",
          text: "Tieto zásady používania cookies môžeme aktualizovať, ako sa mení naše používanie cookies; odzrkadlí to dátum „naposledy aktualizované“ vyššie. Otázky? Napíšte na info@tamanor.com. Pozrite si aj naše Zásady ochrany osobných údajov, ako všeobecne nakladáme s osobnými údajmi.",
        },
      ],
    },
  ],
};

const cookiesDe: LegalDoc = {
  metaTitle: "Cookie-Richtlinie — Tamanor",
  metaDescription:
    "Welche Cookies Tamanor verwendet, warum und wie Sie sie verwalten. Wir verwenden nur unbedingt erforderliche Cookies — keine Werbung, kein seitenübergreifendes Tracking.",
  eyebrow: "Rechtliches",
  title: "Cookie-Richtlinie",
  subtitle:
    "Welche Cookies Tamanor verwendet, warum und wie Sie sie verwalten. Wir halten das minimal — keine Werbung, kein seitenübergreifendes Tracking.",
  updated: UPDATED.de,
  sections: [
    {
      title: "1. Was Cookies sind",
      blocks: [
        {
          type: "p",
          text: "Cookies sind kleine Textdateien, die beim Besuch einer Website auf Ihrem Gerät gespeichert werden. Sie ermöglichen es einer Website, sich etwa zu merken, ob Sie angemeldet sind oder welche Sprache Sie bevorzugen. Für dieselben Zwecke können ähnliche Technologien (z. B. lokaler Speicher) verwendet werden; wenn wir von „Cookies“ sprechen, meinen wir auch diese Technologien.",
        },
      ],
    },
    {
      title: "2. Wie wir Cookies verwenden",
      blocks: [
        {
          type: "p",
          text: "Wir beschränken unsere Verwendung von Cookies auf ein Minimum. Tamanor verwendet nur Cookies, die für den Betrieb der Website und des Dashboards unbedingt erforderlich sind und die Ihre Sprachwahl speichern. Wir verwenden keine Werbe-Cookies und verfolgen Sie nicht über andere Websites hinweg.",
        },
      ],
    },
    {
      title: "3. Cookies, die wir verwenden",
      blocks: [
        {
          type: "table",
          headers: ["Cookie", "Zweck", "Typ", "Dauer"],
          rows: [
            ["tamanor_session", "Hält Sie im Dashboard angemeldet und sichert Ihre Sitzung (httpOnly, SameSite=Lax, in Produktion Secure).", "Unbedingt erforderlich", "7 Tage"],
            ["guardora_locale", "Merkt sich die Sprache der Oberfläche (Englisch, Slowakisch oder Deutsch).", "Erforderlich / funktional", "Bis zu 1 Jahr"],
          ],
        },
        {
          type: "p",
          text: "Standardmäßig laden wir keine Analyse- oder Werbe-Cookies von Drittanbietern. Sollten wir künftig optionale Analyse einführen, holen wir zuvor Ihre Einwilligung ein und aktualisieren diese Richtlinie und die obige Tabelle.",
        },
      ],
    },
    {
      title: "4. Einwilligung und Verwaltung von Cookies",
      blocks: [
        {
          type: "p",
          text: "Unbedingt erforderliche Cookies bedürfen keiner Einwilligung, da der Dienst ohne sie nicht funktionieren kann. Sollten wir jemals nicht erforderliche Cookies einsetzen, holen wir vor dem Setzen Ihre Einwilligung ein, die Sie jederzeit widerrufen können.",
        },
        {
          type: "p",
          text: "Sie können Cookies auch über Ihre Browsereinstellungen steuern — sie blockieren oder löschen. Bitte beachten Sie, dass das Blockieren unbedingt erforderlicher Cookies die Anmeldung verhindert und Teile des Dienstes lahmlegen kann.",
        },
      ],
    },
    {
      title: "5. Cookies von Drittanbietern",
      blocks: [
        {
          type: "p",
          text: "Das Verbinden einer sozialen Plattform leitet Sie zum offiziellen OAuth-Ablauf der jeweiligen Plattform weiter, wo die Plattform (z. B. Meta oder Google) nach ihren eigenen Richtlinien eigene Cookies setzen kann. Diese Cookies unterliegen den Cookie- und Datenschutzrichtlinien der jeweiligen Plattform, nicht dieser Richtlinie.",
        },
      ],
    },
    {
      title: "6. Änderungen und Kontakt",
      blocks: [
        {
          type: "p",
          text: "Wir können diese Cookie-Richtlinie anpassen, wenn sich unsere Verwendung von Cookies ändert; das Datum „Zuletzt aktualisiert“ oben spiegelt dies wider. Fragen? Schreiben Sie an info@tamanor.com. Siehe auch unsere Datenschutzerklärung dazu, wie wir personenbezogene Daten allgemein behandeln.",
        },
      ],
    },
  ],
};

/* ──────────────────────────────────────────────────────────────────────── */

export const privacyPolicy: Record<Locale, LegalDoc> = {
  en: privacyEn,
  sk: privacySk,
  de: privacyDe,
};

export const cookiePolicy: Record<Locale, LegalDoc> = {
  en: cookiesEn,
  sk: cookiesSk,
  de: cookiesDe,
};
