// Slovak (SK) overlay for the knowledge base. Keyed by entry slug.
// Any field left out falls back to the English source in knowledge.ts.
import type { KnowledgeEntryL10n } from "./knowledge";

export const knowledgeSk: Record<string, KnowledgeEntryL10n> = {
  "what-is-tamanor": {
    title: "Čo je Tamanor?",
    metaTitle: "Čo je Tamanor? — Social Account Firewall",
    summary:
      "Tamanor je Social Account Firewall, ktorý monitoruje komentáre a recenzie na pripojených sociálnych účtoch, deteguje riziko pomocou AI a pripravuje bezpečné moderačné akcie, ktoré schvaľuje človek.",
    keywords: ["čo je tamanor", "social account firewall", "moderovanie komentárov", "ochrana reputácie značky"],
    sections: [
      {
        heading: "Firewall pre vašu prítomnosť na sociálnych sieťach",
        body: [
          "Tamanor sa pripája k sociálnym účtom, ktoré značka už vlastní, a nepretržite číta ich komentáre a recenzie. Každú položku klasifikuje z hľadiska rizika — spam, podvody, obťažovanie a opakované rizikové správanie — a zvýrazní to, čo si vyžaduje pozornosť.",
          "Tamanor je v predvolenom nastavení iba na čítanie. Keď je moderačná akcia vhodná, Tamanor ju pripraví a človek ju schváli skôr, než sa na platforme čokoľvek stane. Nikdy sám nepublikuje, neodpovedá ani nemaže.",
        ],
      },
      {
        heading: "Pre koho je určený",
        body: [
          "Značky, agentúry, e-commerce obchody, tvorcovia a lokálne firmy, ktoré dostávajú verejné komentáre a recenzie a potrebujú chrániť svoju reputáciu bez toho, aby ručne sledovali každý kanál.",
        ],
      },
    ],
    faqs: [
      { q: "Publikuje alebo odpovedá Tamanor v mojom mene?", a: "Nie. Tamanor je v predvolenom nastavení iba na čítanie a akcie iba pripravuje; každú moderačnú akciu schvaľuje človek pred jej vykonaním." },
      { q: "Ktoré účty dokáže Tamanor chrániť?", a: "Facebook stránky sú v prevádzke a overené. Konektor pre Instagram Professional je implementačne dokončený, ale čaká na overenie, a Google Business je základom čakajúcim na schválený prístup k API. Pripája sa iba cez oficiálny OAuth." },
    ],
  },
  "how-tamanor-works": {
    title: "Ako Tamanor funguje",
    metaTitle: "Ako Tamanor funguje — monitorovanie, detekcia rizika, schválenie",
    summary:
      "Tamanor sa pripája cez oficiálny OAuth, číta komentáre a recenzie podľa plánu a cez webhooky, klasifikuje riziko pomocou AI a navrhované akcie posiela cez front na schválenie človekom.",
    keywords: ["ako tamanor funguje", "pracovný postup monitorovania komentárov", "moderovanie so schválením človekom", "oauth sociálne siete"],
    sections: [
      {
        heading: "Pripojenie",
        body: [
          "Účet pripojíte cez oficiálny OAuth tok danej platformy. Tamanor ukladá iba OAuth tokeny (v produkcii šifrované v pokoji) — nikdy nie heslo a nikdy nič nescrapuje.",
        ],
      },
      {
        heading: "Monitorovanie",
        body: [
          "Prácu na pozadí vykonáva worker, ktorý číta nové komentáre a recenzie podľa plánu, a webhooky doručujú udalosti takmer v reálnom čase. Každá načítaná položka je normalizovaná a deduplikovaná, takže rovnaký komentár sa nikdy nespracuje dvakrát.",
        ],
      },
      {
        heading: "Detekcia a návrh",
        body: [
          "Každú položku klasifikuje hybridný engine (pravidlá značky spolu s analýzou rizika pomocou AI) na úroveň rizika a kategóriu. Vysokorizikové položky môžu vygenerovať navrhovanú akciu, no Tamanor iba navrhuje — nikdy nič nevykoná automaticky.",
        ],
      },
      {
        heading: "Schválenie",
        body: [
          "Navrhované akcie čakajú vo fronte na schválenie. Recenzent so správnou rolou ich schváli alebo zamietne. Ako živá akcia je dnes povolené iba skrytie komentára na Facebooku, a to až po schválení, pričom celý tok sa zapisuje do nemenného auditného logu.",
        ],
      },
    ],
    faqs: [
      { q: "Aké čerstvé sú dáta?", a: "Naplánované čítania spolu s webhookovými udalosťami. Polling aj webhooky sú deduplikované, takže ich súbeh nikdy nevytvorí duplicitné položky." },
      { q: "Aké akcie dokáže Tamanor vykonať?", a: "Dnes kontrolované skrytie komentára na Facebooku po schválení človekom. Všetko ostatné je monitorovanie a analýza." },
    ],
  },
  "why-tamanor": {
    title: "Prečo Tamanor",
    metaTitle: "Prečo Tamanor — bezpečné, čestné moderovanie s človekom v slučke",
    summary:
      "Tamanor je postavený bezpečne v predvolenom nastavení: iba oficiálny OAuth, iba na čítanie v predvolenom nastavení, schválenie človekom pred akoukoľvek akciou, izolácia nájomníkov na úrovni riadkov a úplná auditná stopa.",
    keywords: ["prečo tamanor", "bezpečné moderovanie", "človek v slučke", "softvér na ochranu značky"],
    sections: [
      {
        heading: "Bezpečný už v návrhu",
        body: [
          "Žiadny scraping, žiadne ukladané heslá, žiadne automatické vykonávanie. Tamanor ponúkne akciu iba vtedy, keď ju platforma naozaj podporuje a keď ju schválil človek.",
        ],
      },
      {
        heading: "Čestný ohľadom schopností",
        body: [
          "Tamanor inzeruje iba to, čo na danej platforme skutočne dokáže. Tam, kde platforma ešte nie je podporovaná, to povie namiesto predstierania. Schopnosti sa čítajú z jediného zdroja pravdy v kódovej báze.",
        ],
      },
    ],
    faqs: [
      { q: "Je Tamanor plne automatizovaný?", a: "Nie — automatizácia pripravuje návrhy; človek zostáva pri každej akcii pri kontrole." },
    ],
  },
  "architecture": {
    title: "Architektúra Tamanoru",
    metaTitle: "Architektúra — Tamanor multi-tenant, čítanie→HTTP→zápis",
    summary:
      "Tamanor je multi-tenant aplikácia s webovou aplikáciou Next.js, workerom na pozadí, PostgreSQL so zabezpečením na úrovni riadkov a vkladateľnými konektormi platforiem, ktoré izolujú sieťové volania poskytovateľov od databázových transakcií.",
    keywords: ["architektúra tamanor", "multi-tenant saas architektúra", "zabezpečenie na úrovni riadkov", "worker na pozadí"],
    sections: [
      {
        heading: "Komponenty",
        body: [
          "Webová aplikácia Next.js obsluhuje dashboard a marketingový web. Samostatný worker proces spúšťa naplánované monitorovanie, kontroly stavu tokenov a nadväzujúce spracovanie webhookov. PostgreSQL je systémom záznamov.",
          "Konektory platforiem sú vkladateľné: produkcia používa skutočné transporty oficiálnych API a testy vkladajú mock transporty, takže presne ten istý produkčný kód beží bez akéhokoľvek sieťového volania.",
        ],
      },
      {
        heading: "Čítanie → HTTP poskytovateľa → zápis",
        body: [
          "Databázová práca beží v krátkych transakciách obmedzených na nájomníka. HTTP volania poskytovateľov prebiehajú výhradne medzi transakciami, nikdy nie vnútri jednej, takže pomalý alebo zlyhávajúci poskytovateľ nikdy nemôže držať databázový zámok ani poškodiť lokálny stav.",
        ],
      },
    ],
    faqs: [
      { q: "Zdieľa worker prístup webovej aplikácie k databáze?", a: "Oba používajú tú istú runtime rolu so zabezpečením na úrovni riadkov; ani jeden nemôže obísť izoláciu nájomníkov." },
    ],
  },
  "security": {
    title: "Bezpečnosť Tamanoru",
    metaTitle: "Bezpečnosť — Tamanor iba OAuth, iba na čítanie v predvolenom nastavení",
    summary:
      "Tamanor sa pripája iba cez oficiálny OAuth, nikdy nescrapuje, nikdy neukladá heslá, tokeny drží na strane servera a mimo logov a je v predvolenom nastavení iba na čítanie so schválením človekom pred akoukoľvek akciou.",
    keywords: ["bezpečnosť tamanor", "iba oauth", "žiadny scraping", "bezpečnosť ochrany značky"],
    sections: [
      {
        heading: "Pripojenia",
        body: [
          "Iba oficiálne OAuth a API integrácie. Tamanor nikdy nescrapuje žiadnu platformu a nikdy nežiada ani neukladá heslá k sociálnym sieťam. Kontroly schopností platformy prebiehajú pred ponúknutím akejkoľvek akcie.",
        ],
      },
      {
        heading: "Tokeny",
        body: [
          "OAuth tokeny sa ukladajú iba na strane servera, v produkcii šifrované v pokoji. Nikdy sa nezobrazujú v rozhraní, nikdy sa nezapisujú do logov a nikdy sa nezahŕňajú do auditnej stopy.",
        ],
      },
      {
        heading: "Izolácia a audit",
        body: [
          "Dáta každého nájomníka sú izolované pomocou zabezpečenia na úrovni riadkov v PostgreSQL. Každá zmysluplná akcia je zaznamenaná v auditnom logu, do ktorého sa len pridáva.",
        ],
      },
    ],
    faqs: [
      { q: "Ukladáte moje heslo k sociálnej sieti?", a: "Nikdy. Tamanor používa oficiálny OAuth; heslá sa nikdy nevyžadujú ani neukladajú." },
      { q: "Zapisujú sa tokeny niekedy do logov?", a: "Nie. Tokeny sa držia mimo logov, používateľského rozhrania, chybových hlásení a auditnej stopy." },
    ],
  },
  "row-level-security": {
    title: "Zabezpečenie na úrovni riadkov (RLS)",
    metaTitle: "Zabezpečenie na úrovni riadkov — izolácia nájomníkov v Tamanore",
    summary:
      "Tamanor vynucuje izoláciu nájomníkov na úrovni databázy pomocou zabezpečenia na úrovni riadkov v PostgreSQL, takže zabudnutý filter v aplikačnom kóde nikdy nemôže uniknúť dáta iného nájomníka.",
    keywords: ["zabezpečenie na úrovni riadkov", "postgres rls", "multi-tenant izolácia", "bezpečnosť nájomníka"],
    sections: [
      {
        heading: "Izolácia v databáze, nielen v aplikácii",
        body: [
          "Každý dotaz obmedzený na nájomníka beží cez databázovú rolu bez oprávnení superusera s FORCE ROW LEVEL SECURITY a politikou izolácie nájomníkov. Aktuálny nájomník sa nastavuje na každú transakciu; samotná databáza odmieta riadky ktoréhokoľvek iného nájomníka.",
          "Je to obrana do hĺbky: aj keby aplikačný kód zabudol na filter podľa nájomníka, databáza aj tak vráti iba riadky aktívneho nájomníka.",
        ],
      },
    ],
    faqs: [
      { q: "Čo ak dotaz zabudne filtrovať podľa nájomníka?", a: "Zabezpečenie na úrovni riadkov aj tak obmedzí výsledky na aktívneho nájomníka — izolácia nezávisí od toho, či si aplikačný kód spomenie na filtrovanie." },
    ],
  },
  "audit-log": {
    title: "Auditný log",
    metaTitle: "Auditný log — história akcií Tamanoru len s pridávaním",
    summary:
      "Tamanor zaznamenáva každú zmysluplnú akciu — pripojenia, synchronizácie, návrhy, schválenia a moderovanie — do auditného logu obmedzeného na nájomníka, do ktorého sa len pridáva a ktorý nikdy neobsahuje materiál tokenov.",
    keywords: ["auditný log", "auditná stopa moderovania", "logovanie pre compliance", "história akcií"],
    sections: [
      {
        heading: "Každá akcia trvalo zaznamenaná",
        body: [
          "Pripojenie účtu, spustenie synchronizácie, navrhnutie akcie, jej schválenie alebo zamietnutie a vykonanie schváleného skrytia sa vždy zapisujú do auditného logu s aktérom, cieľom a metadátami. Záznamy sa len pridávajú a sú obmedzené na nájomníka.",
          "Metadáta auditu sú zbavené tajomstiev: v auditnom zázname sa nikdy nezobrazí žiadny token, heslo ani databázová URL.",
        ],
      },
    ],
    faqs: [
      { q: "Dajú sa auditné záznamy upraviť alebo zmazať?", a: "Do auditného logu sa len pridáva; záznamy sa neupravujú na mieste." },
    ],
  },
  "permission-model": {
    title: "Model oprávnení",
    metaTitle: "Model oprávnení — oprávnenia platformy a rolí v Tamanore",
    summary:
      "Tamanor oddeľuje schopnosti platformy (čo OAuth grant účtu skutočne umožňuje) od rolí v pracovnom priestore (čo smie robiť člen tímu) a akciu ponúkne iba vtedy, keď ju povoľujú obe.",
    keywords: ["model oprávnení", "oauth oprávnenia", "prístup na základe rolí", "kontroly schopností"],
    sections: [
      {
        heading: "Dve vrstvy oprávnení",
        body: [
          "Oprávnenie platformy je pravda o tom, čo dokáže pripojený účet — čítať komentáre, skryť komentár, čítať recenzie — odvodená z OAuth grantu a API platformy. Oprávnenie pracovného priestoru je to, čo umožňuje rola člena tímu v rámci Tamanoru.",
          "Akcia sa ponúkne iba vtedy, keď ju platforma podporuje A rola používateľa ju umožňuje. Chýbajúce oprávnenia platformy sa čestne zobrazia ako výzva na opätovné pripojenie alebo opätovné udelenie práv.",
        ],
      },
    ],
    faqs: [
      { q: "Čo sa stane, ak sa oprávnenie na platforme odvolá?", a: "Tamanor zistí odvolané oprávnenie pri ďalšej kontrole a zobrazí výzvu na opätovné pripojenie namiesto tichého zlyhania." },
    ],
  },
  "role-model": {
    title: "Model rolí",
    metaTitle: "Model rolí — roly v pracovnom priestore Tamanoru",
    summary:
      "Tamanor používa prístup na základe rolí v rámci každého pracovného priestoru, takže vlastníci, správcovia, analytici, recenzenti a pozorovatelia vidia a robia iba to, čo umožňuje ich rola.",
    keywords: ["riadenie prístupu na základe rolí", "rbac", "roly v pracovnom priestore", "tímové oprávnenia"],
    sections: [
      {
        heading: "Roly zodpovedajú úlohe",
        body: [
          "Roly v pracovnom priestore vymedzujú, kto môže pripájať účty, kto môže schvaľovať moderačné akcie a kto môže iba prezerať analytiku. Kontroly rolí bežia na strane servera pri každej chránenej akcii, vrstvené nad zabezpečením databázy na úrovni riadkov.",
        ],
      },
    ],
    faqs: [
      { q: "Môže pozorovateľ schváliť moderačnú akciu?", a: "Nie. Schvaľovanie je vyhradené pre roly, ktoré ho umožňujú; pozorovatelia môžu čítať, ale nie konať." },
    ],
  },
  "webhook-architecture": {
    title: "Architektúra webhookov",
    metaTitle: "Architektúra webhookov — Tamanor podpísané, deduplikované udalosti",
    summary:
      "Tamanor overuje podpis každého prichádzajúceho webhooku, smeruje udalosti Facebooku a Instagramu cez jeden zjednotený konektor, odmieta opakovania a nájomníka vždy určuje z pripojeného účtu — nikdy z payloadu.",
    keywords: ["architektúra webhookov", "overenie podpisu webhooku", "ochrana proti opakovaniu", "meta webhooky"],
    sections: [
      {
        heading: "Dôveryhodné už z podstaty",
        body: [
          "Prichádzajúce udalosti sa overujú podpisom HMAC skôr, než sa čomukoľvek dôveruje. Stabilný deduplikačný kľúč odmieta opakované doručenia. Spracujú sa iba udalosti s platným podpisom; sfalšované alebo nepodpísané udalosti sa ukladajú na účely auditu, ale nikdy sa na ich základe nekoná.",
          "Nájomník sa vždy odvodzuje zo zhodujúceho sa pripojeného účtu, nikdy z tela webhooku, takže vyrobený payload nemôže prekročiť hranice medzi nájomníkmi.",
        ],
      },
    ],
    faqs: [
      { q: "Čo zastaví opakovaný alebo sfalšovaný webhook?", a: "Overenie podpisu spolu s jedinečným deduplikačným kľúčom: opakovania sa zlúčia do jednej udalosti a nepodpísané udalosti sa nikdy nespracujú." },
    ],
  },
  "worker-architecture": {
    title: "Architektúra workera",
    metaTitle: "Architektúra workera — naplánované monitorovanie Tamanoru",
    summary:
      "Samostatný worker Tamanoru spúšťa naplánované monitorovanie iba na čítanie, kontroly vypršania tokenov a nadväzujúce spracovanie webhookov, každé v dôveryhodnom kontexte nájomníka a s leaseom na úrovni účtu, ktorý zabraňuje prekrývajúcim sa synchronizáciám.",
    keywords: ["worker na pozadí", "naplánovaná synchronizácia", "sync lease", "monitor tokenov"],
    sections: [
      {
        heading: "Jedna synchronizácia na účet, bezpečne",
        body: [
          "Worker si pred synchronizáciou získa krátkodobý lease na úrovni účtu, takže naplánovaný a manuálny beh sa nikdy nemôžu zraziť. Čítania sú idempotentné; každá položka sa vytvorí raz a pri zmene sa aktualizuje na mieste.",
          "Worker iba číta. Nikdy nevykoná moderačnú akciu; tie prechádzajú výhradne cez front na schválenie.",
        ],
      },
    ],
    faqs: [
      { q: "Môžu pre ten istý účet bežať dve synchronizácie naraz?", a: "Nie. Lease na úrovni účtu zaručuje jedinú aktívnu synchronizáciu; druhý beh sa čisto preskočí." },
    ],
  },
  "data-protection": {
    title: "Ochrana údajov",
    metaTitle: "Ochrana údajov — minimálne, izolované dáta v Tamanore",
    summary:
      "Tamanor ukladá iba OAuth tokeny a verejný obsah potrebný na ochranu značky, izoluje ich pre každého nájomníka pomocou zabezpečenia na úrovni riadkov, drží tajomstvá mimo logov a automaticky maže krátkodobé onboardingové dáta.",
    keywords: ["ochrana údajov", "minimalizácia dát", "pripravenosť na gdpr", "izolácia dát nájomníka"],
    sections: [
      {
        heading: "Ukladajte menej, chráňte viac",
        body: [
          "Tamanor prijíma verejné komentáre a recenzie plus OAuth tokeny potrebné na ich čítanie. Tokeny sú v produkcii šifrované v pokoji a nikdy sa neodhaľujú. Krátkodobé onboardingové relácie, ktoré držia dočasné tokeny, sa automaticky zmažú po ich vypršaní.",
        ],
      },
    ],
    faqs: [
      { q: "Zdieľajú sa dáta medzi zákazníkmi?", a: "Nie. Zabezpečenie na úrovni riadkov izoluje dáta každého nájomníka na úrovni databázy." },
    ],
  },
  "privacy": {
    title: "Súkromie",
    metaTitle: "Súkromie — nakladanie s dátami v Tamanore",
    summary:
      "Tamanor spracúva verejný sociálny obsah a OAuth tokeny výhradne na účel ochrany pripojenej značky, s izoláciou nájomníkov, odstraňovaním tajomstiev a bez predaja dát.",
    keywords: ["súkromie", "ochrana súkromia", "nakladanie so sociálnymi dátami"],
    sections: [
      {
        heading: "Spracovanie obmedzené účelom",
        body: [
          "Obsah a tokeny sa spracúvajú iba na monitorovanie a ochranu účtov, ktoré zákazník pripojí. Tamanor nepredáva dáta zákazníkov. Záväzné znenie nájdete v zásadách ochrany súkromia.",
        ],
      },
    ],
    faqs: [
      { q: "Kde je záväzné vyhlásenie o súkromí?", a: "Záväzným zdrojom je stránka so zásadami ochrany súkromia; táto stránka zhŕňa technický postoj." },
    ],
  },
  "encryption": {
    title: "Šifrovanie",
    metaTitle: "Šifrovanie — šifrovanie tokenov v pokoji v Tamanore",
    summary:
      "Tamanor v produkcii šifruje OAuth tokeny v pokoji a blokuje ukladanie tokenov v otvorenom texte v produkcii, takže poverenia sú chránené aj na úrovni databázy.",
    keywords: ["šifrovanie v pokoji", "šifrovanie tokenov", "kms", "ochrana poverení"],
    sections: [
      {
        heading: "Tokeny šifrované v pokoji",
        body: [
          "V produkcii sa OAuth tokeny pred uložením šifrujú a bezpečnostná kontrola bráni ukladaniu tokenov v otvorenom texte. Tokeny sa dešifrujú iba v pamäti pri vykonaní čítania a nikdy sa nezapisujú do logov ani nezobrazujú.",
        ],
      },
    ],
    faqs: [
      { q: "Ukladajú sa tokeny v otvorenom texte?", a: "V produkcii nie — ukladanie tokenov v otvorenom texte je blokované a tokeny sú šifrované v pokoji." },
    ],
  },
  "ai-moderation": {
    title: "AI moderovanie",
    metaTitle: "AI moderovanie — detekcia rizika Tamanoru so schválením človekom",
    summary:
      "AI Tamanoru klasifikuje každý komentár a recenziu z hľadiska rizika a kategórie, kombinuje pravidlá značky s analýzou AI a potom navrhne akcie na schválenie človekom — nikdy nemoderuje automaticky.",
    keywords: ["ai moderovanie", "detekcia rizika komentárov", "klasifikácia obsahu", "pravidlá značky"],
    sections: [
      {
        heading: "Hybridná klasifikácia",
        body: [
          "Každú položku ohodnotí hybridný engine: deterministické pravidlá značky plus analýza rizika pomocou AI. Výsledkom je úroveň rizika, kategórie a sentiment, ktoré sa používajú na prioritizáciu toho, čo človek uvidí ako prvé.",
          "Výstup AI poháňa iba návrhy a prioritizáciu. Akúkoľvek akciu, ktorá sa dotýka platformy, schvaľuje človek.",
        ],
      },
    ],
    faqs: [
      { q: "Skrýva AI komentáre sama?", a: "Nie. AI deteguje a navrhuje; skrytie komentára si vyžaduje schválenie človekom." },
    ],
  },
  "automation": {
    title: "Automatizácia",
    metaTitle: "Automatizácia — Tamanor navrhuje, ľudia rozhodujú",
    summary:
      "Tamanor automatizuje monitorovanie, detekciu rizika a prípravu akcií, no vykonávanie ponecháva na schválení človekom: automatizácia vytvára návrhy, nikdy sama nevykoná moderovanie.",
    keywords: ["automatizácia moderovania", "bezpečná automatizácia", "automatizácia s človekom v slučke"],
    sections: [
      {
        heading: "Automatizujte prácu, nie rozhodnutie",
        body: [
          "Naplánované monitorovanie, deduplikované prijímanie, hodnotenie rizika a generovanie návrhov sú automatizované. Rozhodnutie konať zostáva na človeku, takže automatizácia nikdy nič nepublikuje, neskryje ani nezmaže bez schválenia.",
        ],
      },
    ],
    faqs: [
      { q: "Môžem zapnúť plne automatické skrývanie?", a: "Automatické vykonávanie je zámerne nepovolené; návrhy sa pripravujú na schválenie človekom." },
    ],
  },
  "proposal-engine": {
    title: "Engine návrhov",
    metaTitle: "Engine návrhov — Tamanor pripravuje bezpečné akcie",
    summary:
      "Pri vysokorizikových položkách Tamanor pripraví navrhovanú moderačnú akciu s kontextom a nasmeruje ju do frontu na schválenie; navrhuje, ale nikdy nič nevykoná automaticky.",
    keywords: ["engine návrhov", "návrhy moderovania", "front na schválenie", "detekcia vysokého rizika"],
    sections: [
      {
        heading: "Od rizika k preskúmateľnému návrhu",
        body: [
          "Keď je položka vysoko riziková a nemá otvorený návrh, Tamanor jeden pripraví. Návrh nesie dôvod a cieľ, takže recenzent môže rýchlo rozhodnúť. Na platformu sa nič nedostane, kým sa návrh neschváli.",
        ],
      },
    ],
    faqs: [
      { q: "Vypršia alebo sa duplikujú návrhy?", a: "Tamanor sa vyhýba duplicitným návrhom pre tú istú položku a každý návrh drží preskúmateľný vo fronte." },
    ],
  },
  "roadmap": {
    title: "Plán rozvoja",
    metaTitle: "Plán rozvoja — čestný stav platforiem v Tamanore",
    summary:
      "Monitorovanie komentárov na Facebook stránkach je overene v prevádzke. Instagram je implementačne dokončený, ale čaká na overenie (Meta App Review). Google Business je základom čakajúcim na schválený prístup k API. YouTube, LinkedIn a TikTok sú vo výskume — nie sú podporované.",
    keywords: ["plán rozvoja tamanor", "podpora platforiem", "instagram čaká na overenie", "recenzie google business"],
    sections: [
      {
        heading: "Čo je v prevádzke, čo čaká a čo je vo výskume",
        body: [
          "V prevádzke (overené): monitorovanie komentárov na Facebook stránkach iba na čítanie, so skrývaním schváleným človekom vypnutým v predvolenom nastavení.",
          "Implementačne dokončené, čaká na overenie: monitorovanie komentárov Instagram Professional (iba na čítanie) — pred spustením čaká na Meta App Review.",
          "Základ, čaká na overenie: monitorovanie recenzií Google Business — pripravené na schválený prístup k API, zatiaľ nie je v prevádzke.",
          "Výskum (nie je podporované): YouTube, LinkedIn a TikTok. Tamanor si nenárokuje podporu, kým nie je skutočná a overená.",
        ],
      },
    ],
    faqs: [
      { q: "Podporuje Tamanor dnes TikTok, YouTube alebo LinkedIn?", a: "Zatiaľ nie. Sú v pláne; Tamanor čestne uvádza, že si nenárokuje ich podporu, kým nie je overená." },
    ],
  },
  "comment-monitoring": {
    title: "Monitorovanie komentárov a recenzií",
    metaTitle: "Monitorovanie komentárov — Tamanor",
    summary:
      "Tamanor nepretržite číta komentáre a recenzie na pripojených účtoch, deduplikuje ich a každú klasifikuje z hľadiska rizika, aby nič dôležité neuniklo.",
    keywords: ["monitorovanie komentárov", "monitorovanie recenzií", "sociálne počúvanie", "zmienky o značke"],
    sections: [
      {
        heading: "Nikdy nezmeškajte rizikový komentár",
        body: [
          "Tamanor číta nové komentáre a recenzie podľa plánu a cez webhooky, normalizuje ich do jedného modelu a deduplikuje podľa účtu a externého id, takže rovnaká položka sa nikdy nepočíta dvakrát.",
        ],
      },
    ],
    faqs: [{ q: "Ktoré platformy sú dnes monitorované?", a: "Facebook stránky a pripojené účty Instagram Professional plus recenzie Google Business ako základ." }],
  },
  "reputation-analytics": {
    title: "Analytika reputácie",
    metaTitle: "Analytika reputácie — Tamanor",
    summary:
      "Tamanor premieňa monitorované komentáre a recenzie na analytiku reputácie — úrovne rizika, kategórie a trendy — aby značka videla svoju expozíciu na prvý pohľad.",
    keywords: ["analytika reputácie", "reputácia značky", "sentiment", "trendy rizika"],
    sections: [
      {
        heading: "Vidieť svoju expozíciu",
        body: [
          "Klasifikované položky sa zoskupujú do pohľadov na reputáciu podľa úrovne rizika a kategórie, čo tímom pomáha zamerať sa najprv na problémy s najväčším dopadom.",
        ],
      },
    ],
    faqs: [{ q: "Je analýza založená na skutočnom obsahu?", a: "Áno — analytika sa počíta zo skutočných komentárov a recenzií, ktoré Tamanor monitoruje, nie zo vzorových dát." }],
  },
  "actor-risk": {
    title: "Riziko aktéra",
    metaTitle: "Riziko aktéra — detekcia opakovaných previnilcov v Tamanore",
    summary:
      "Tamanor sleduje opakované rizikové správanie toho istého autora naprieč obsahom značky, takže vytrvalí zlomyseľní aktéri vyniknú namiesto posudzovania jedného komentára po druhom.",
    keywords: ["riziko aktéra", "detekcia opakovaných previnilcov", "koordinované zneužívanie", "reputácia autora"],
    sections: [
      {
        heading: "Posudzujte vzorec, nielen jeden komentár",
        body: [
          "Priradením rizika k autorom v čase Tamanor zvýrazní účty, ktoré opakovane uverejňujú spam, podvody alebo obťažovanie, čím dáva recenzentom kontext, ktorý jeden komentár poskytnúť nemôže.",
        ],
      },
    ],
    faqs: [{ q: "Banuje Tamanor autorov automaticky?", a: "Nie. Riziko aktéra informuje recenzentov; Tamanor autorov nebanuje ani proti nim nekoná automaticky." }],
  },
  "action-queue": {
    title: "Front akcií",
    metaTitle: "Front akcií — akcie schválené človekom v Tamanore",
    summary:
      "Front akcií Tamanoru drží navrhované moderačné akcie na kontrolu človekom; na platforme sa nič nespustí, kým to recenzent neschváli.",
    keywords: ["front akcií", "front moderovania", "front na schválenie"],
    sections: [
      {
        heading: "Jedno miesto na rozhodovanie",
        body: [
          "Navrhované akcie sa zhromažďujú v jednom fronte s kontextom potrebným na rozhodnutie. Schválenie spustí akciu (dnes skrytie komentára na Facebooku); zamietnutie ju uzavrie. Každý výsledok je auditovaný.",
        ],
      },
    ],
    faqs: [{ q: "Aké akcie možno dnes schváliť?", a: "Kontrolované skrytie komentára na Facebooku. Ostatné platformy sú iba monitorované." }],
  },
  "approval-workflow": {
    title: "Pracovný postup schvaľovania",
    metaTitle: "Pracovný postup schvaľovania — Tamanor",
    summary:
      "Pracovný postup schvaľovania Tamanoru drží človeka pri kontrole: navrhované akcie schvaľuje alebo zamieta autorizovaná rola skôr, než sa čokoľvek dotkne platformy, pričom každý krok je auditovaný.",
    keywords: ["pracovný postup schvaľovania", "človek v slučke", "schválenie moderovania"],
    sections: [
      {
        heading: "Kontrola človekom od začiatku do konca",
        body: [
          "Návrh sa vytvorí, skontroluje ho autorizovaná rola a až potom sa vykoná. Celý životný cyklus — navrhnuté, schválené alebo zamietnuté, vykonané — sa zapíše do auditného logu.",
        ],
      },
    ],
    faqs: [{ q: "Kto môže schvaľovať?", a: "Iba roly v pracovnom priestore oprávnené schvaľovať; kontroly rolí bežia na strane servera." }],
  },
  "auto-protection": {
    title: "Politiky automatickej ochrany",
    metaTitle: "Automatická ochrana — bezpečné predvolené nastavenia v Tamanore",
    summary:
      "Politiky automatickej ochrany umožňujú značke definovať, kedy má Tamanor pre jednotlivé kategórie pripraviť ochrannú akciu — stále smerovanú cez schválenie človekom, nikdy vykonanú automaticky.",
    keywords: ["automatická ochrana", "politika moderovania", "bezpečná automatizácia", "pravidlá značky"],
    sections: [
      {
        heading: "Politika dnu, návrhy von",
        body: [
          "Nastavíte politiky pre jednotlivé kategórie určujúce, ako agresívne má Tamanor reagovať. Politiky ovplyvňujú, čo sa navrhne a prioritizuje; neumožňujú automatické vykonávanie.",
        ],
      },
    ],
    faqs: [{ q: "Môže politika skrývať komentáre automaticky?", a: "Nie — politiky formujú návrhy; schválenie zostáva na človeku." }],
  },
  "control-center": {
    title: "Riadiace centrum",
    metaTitle: "Riadiace centrum — pravidlá a nastavenia v Tamanore",
    summary:
      "Riadiace centrum Tamanoru je miesto, kde značka konfiguruje pravidlá, kategórie a nastavenia ochrany, ktoré poháňajú monitorovanie a návrhy.",
    keywords: ["riadiace centrum", "pravidlá moderovania", "konfigurácia značky"],
    sections: [
      {
        heading: "Nakonfigurujte firewall",
        body: [
          "Pravidlá značky a nastavenia ochrany sídlia na jednom mieste, takže tímy môžu doladiť, čo sa považuje za riziko a ako sa pripravujú návrhy.",
        ],
      },
    ],
    faqs: [{ q: "Sú pravidlá pre každú značku?", a: "Áno — pravidlá a politiky sú vymedzené pre každú značku v rámci pracovného priestoru." }],
  },
  "unified-inbox": {
    title: "Zjednotená schránka",
    metaTitle: "Zjednotená schránka — Tamanor",
    summary:
      "Tamanor prináša komentáre a recenzie z pripojených účtov do jednej schránky, takže tímy triedia riziko naprieč platformami v jednom zobrazení.",
    keywords: ["zjednotená schránka", "sociálna schránka", "moderovanie naprieč platformami"],
    sections: [
      {
        heading: "Jedno zobrazenie naprieč účtami",
        body: [
          "Monitorované položky z každého pripojeného účtu sa zobrazia v zdieľanej schránke s kontextom rizika, takže triedenie nie je rozdrobené po záložkách jednotlivých platforiem.",
        ],
      },
    ],
    faqs: [{ q: "Umožňuje mi schránka odpovedať?", a: "Schránka slúži na triedenie a schvaľovanie; Tamanor za vás neuverejňuje odpovede." }],
  },
  "ai-risk-detection": {
    title: "AI detekcia rizika",
    metaTitle: "AI detekcia rizika — Tamanor",
    summary:
      "Tamanor klasifikuje každý komentár a recenziu hybridom pravidiel značky a analýzy AI, čím vytvára úroveň rizika, kategórie a sentiment používané na prioritizáciu a návrhy.",
    keywords: ["ai detekcia rizika", "klasifikácia obsahu", "detekcia spamu a podvodov", "detekcia obťažovania"],
    sections: [
      {
        heading: "Pravidlá plus AI",
        body: [
          "Deterministické pravidlá značky zachytávajú známe vzorce; analýza AI zvláda nuansy a jazyk. Spolu vytvárajú signály rizika, ktoré poháňajú to, čo človek uvidí a čo sa navrhne.",
        ],
      },
    ],
    faqs: [{ q: "Robí AI konečné rozhodnutie?", a: "Nie — AI informuje prioritizáciu a návrhy; rozhoduje človek." }],
  },
  "facebook": {
    title: "Integrácia Facebook stránok",
    metaTitle: "Integrácia Facebooku — ochrana komentárov v Tamanore",
    summary:
      "Tamanor pripája Facebook stránky cez oficiálny OAuth, aby monitoroval komentáre, detegoval riziko a po schválení človekom skrýval škodlivé komentáre — jedinú živú moderačnú akciu dneška.",
    keywords: ["moderovanie facebook stránky", "skrytie facebook komentárov", "monitorovanie facebook komentárov", "meta oauth"],
    sections: [
      {
        heading: "Čo Tamanor robí s Facebookom",
        body: [
          "Tamanor číta komentáre na stránke a pod príspevkami, klasifikuje ich a po schválení človekom dokáže komentár skryť. Skrytý stav sa dá overiť. Tamanor nikdy nemaže, neodpovedá, nedáva lajky, nebanuje ani nenahlasuje.",
        ],
      },
    ],
    faqs: [
      { q: "Dokáže Tamanor skrývať komentáre na Facebooku?", a: "Áno, po schválení človekom. Toto je jediná živá moderačná akcia, ktorú Tamanor dnes vykonáva." },
      { q: "Maže alebo odpovedá Tamanor na Facebooku?", a: "Nie. Tamanor iba skrýva (po schválení) a inak monitoruje." },
    ],
  },
  "instagram": {
    title: "Integrácia Instagramu",
    metaTitle: "Integrácia Instagramu — Tamanor (čaká na overenie)",
    summary:
      "Konektor Tamanoru pre Instagram Professional je implementačne dokončený — objavenie cez prepojenú Facebook stránku, prijímanie komentárov iba na čítanie so stránkovaním a webhookmi. Skutočné overenie poskytovateľa cez Meta App Review čaká, takže zatiaľ nie je v prevádzke.",
    keywords: ["moderovanie instagram business", "monitorovanie instagram komentárov", "instagram professional oauth"],
    sections: [
      {
        heading: "Čo Tamanor robí s Instagramom",
        body: [
          "Konektor Instagramu objaví pripojený účet Instagram Professional cez jeho Facebook stránku a číta jeho komentáre — komentáre a odpovede pod médiami, so stránkovaním a webhookmi takmer v reálnom čase. Je iba na čítanie: žiadne skrývanie, mazanie, odpovedanie, banovanie ani nahlasovanie.",
          "Stav: implementačne dokončené, skutočné overenie poskytovateľa čaká. Živé používanie si vyžaduje Meta App Review; dovtedy Tamanor Instagram neprezentuje ako živý.",
        ],
      },
    ],
    faqs: [
      { q: "Je Instagram dnes v prevádzke?", a: "Nie. Konektor Instagramu je implementačne dokončený, ale zatiaľ nie je v prevádzke — skutočné overenie poskytovateľa cez Meta App Review čaká." },
      { q: "Dokáže Tamanor skrývať komentáre na Instagrame?", a: "Nie. Instagram je iba na čítanie; nie je povolená žiadna moderačná akcia." },
      { q: "Ako je Instagram pripojený?", a: "Cez jeho prepojenú Facebook stránku pomocou oficiálneho OAuth — oba sa správajú ako jeden zjednotený konektor." },
    ],
  },
  "google-business": {
    title: "Integrácia Google Business",
    metaTitle: "Integrácia Google Business — Tamanor (čaká na overenie)",
    summary:
      "Konektor Tamanoru pre Google Business Profile je základom pripraveným na schválený prístup k API — číta recenzenta, hodnotenie a text. Skutočné overenie poskytovateľa čaká, takže monitorovanie recenzií zatiaľ nie je v prevádzke.",
    keywords: ["recenzie google business", "monitorovanie recenzií", "google business profile api"],
    sections: [
      {
        heading: "Čo Tamanor robí s Google Business",
        body: [
          "Konektor Google Business číta recenzie prevádzky (recenzent, hodnotenie hviezdičkami, text recenzie) do reputácie. Na recenzie neodpovedá automaticky.",
          "Stav: implementácia/základ konektora je pripravený na schválený prístup k API; skutočné overenie poskytovateľa čaká. Monitorovanie recenzií zatiaľ nie je v prevádzke a ani sa tak neprezentuje.",
        ],
      },
    ],
    faqs: [
      { q: "Je monitorovanie recenzií Google Business v prevádzke?", a: "Nie. Konektor je základom pripraveným na schválený prístup k API; skutočné overenie poskytovateľa čaká." },
      { q: "Odpovedá Tamanor na recenzie Google?", a: "Nie — odpovede na recenzie nie sú automatizované." },
    ],
  },
  "youtube": {
    title: "Integrácia YouTube (plánovaná)",
    metaTitle: "Integrácia YouTube (plánovaná) — Tamanor",
    summary:
      "Konektor YouTube je plánovaný. Tamanor si zatiaľ nenárokuje podporu YouTube; monitorovanie komentárov sa povolí až po jeho vybudovaní a overení.",
    keywords: ["monitorovanie youtube komentárov", "moderovanie youtube", "plánovaná integrácia"],
    sections: [
      {
        heading: "Plánované, zatiaľ nenárokované",
        body: [
          "YouTube sprístupňuje vlákna komentárov cez svoje oficiálne API. V kódovej báze existuje základ konektora, ale Tamanor neinzeruje podporu YouTube, kým nie je implementovaná a overená synchronizácia čítania.",
        ],
      },
    ],
    faqs: [{ q: "Môžem dnes monitorovať YouTube?", a: "Zatiaľ nie — YouTube je plánovaný a nie je nárokovaný ako podporovaný." }],
  },
  "linkedin": {
    title: "Integrácia LinkedIn (plánovaná)",
    metaTitle: "Integrácia LinkedIn (plánovaná) — Tamanor",
    summary:
      "Konektor pre LinkedIn Company Page je plánovaný. Prístup LinkedIn API k organickým komentárom je vyhradený pre partnerov, takže Tamanor neinzeruje žiadne schopnosti LinkedIn, kým nie je prístup overený.",
    keywords: ["linkedin company page", "moderovanie linkedin", "plánovaná integrácia"],
    sections: [
      {
        heading: "Čestne o obmedzenom prístupe",
        body: [
          "LinkedIn výrazne obmedzuje prístup k organickým komentárom. Kým tento prístup nie je udelený a overený, Tamanor si nenárokuje žiadnu schopnosť LinkedIn.",
        ],
      },
    ],
    faqs: [{ q: "Podporuje Tamanor LinkedIn?", a: "Zatiaľ nie — je plánovaný a prístup je vyhradený pre partnerov." }],
  },
  "tiktok": {
    title: "Integrácia TikTok (plánovaná)",
    metaTitle: "Integrácia TikTok (plánovaná) — Tamanor",
    summary:
      "Konektor TikTok je plánovaný. Čítanie/moderovanie komentárov cez oficiálne API je podmienené app review, takže Tamanor neinzeruje žiadne schopnosti TikTok, kým nie sú preukázané.",
    keywords: ["moderovanie tiktok komentárov", "tiktok business api", "plánovaná integrácia"],
    sections: [
      {
        heading: "Plánované, podmienené kontrolou",
        body: [
          "Oficiálne API TikTok pre komentáre je obmedzené a podmienené app review. Tamanor čestne uvádza, že TikTok je plánovaný a zatiaľ nie je podporovaný.",
        ],
      },
    ],
    faqs: [{ q: "Podporuje Tamanor TikTok?", a: "Zatiaľ nie — je plánovaný a podmienený app review." }],
  },
  "getting-started": {
    title: "Začíname",
    metaTitle: "Začíname — dokumentácia Tamanoru",
    summary:
      "Pripojte Facebook stránku alebo účet Instagram Professional cez oficiálny OAuth, nechajte Tamanor monitorovať komentáre a schvaľujte navrhované akcie z frontu.",
    keywords: ["začíname", "nastavenie tamanor", "pripojenie sociálneho účtu"],
    sections: [
      {
        heading: "Tri kroky",
        body: [
          "1) Pripojte účet cez oficiálny OAuth. 2) Tamanor začne monitorovať a klasifikovať komentáre. 3) Skontrolujte navrhované akcie vo fronte na schválenie a schváľte alebo zamietnite ich.",
        ],
      },
    ],
    faqs: [{ q: "Potrebujem heslo?", a: "Nie — pripájate sa cez oficiálny OAuth, nikdy nie cez heslo." }],
  },
  "connect-facebook": {
    title: "Pripojenie Facebook stránky",
    metaTitle: "Pripojenie Facebooku — dokumentácia Tamanoru",
    summary:
      "Pripojte Facebook stránku cez oficiálny OAuth od Meta, aby Tamanor mohol monitorovať komentáre a po schválení skrývať škodlivé.",
    keywords: ["pripojenie facebooku", "facebook oauth", "nastavenie facebook stránky"],
    sections: [
      {
        heading: "Pripojenie cez OAuth",
        body: [
          "Spustite pripojenie, udeľte požadované oprávnenia na Meta a Tamanor uloží iba OAuth token (v produkcii šifrovaný). Tamanor potom objaví vašu stránku a začne monitorovanie iba na čítanie.",
        ],
      },
    ],
    faqs: [{ q: "Aké oprávnenia sú potrebné?", a: "Oprávnenia stránky potrebné na čítanie komentárov a na skrývanie na správu interakcií — vyžiadané cez OAuth od Meta." }],
  },
  "connect-instagram": {
    title: "Pripojenie účtu Instagram",
    metaTitle: "Pripojenie Instagramu — dokumentácia Tamanoru",
    summary:
      "Pripojte účet Instagram Professional cez jeho prepojenú Facebook stránku pomocou oficiálneho OAuth, aby Tamanor mohol monitorovať jeho komentáre (iba na čítanie).",
    keywords: ["pripojenie instagramu", "instagram professional", "instagram oauth"],
    sections: [
      {
        heading: "Pripojené cez Facebook stránku",
        body: [
          "Tamanor počas OAuth objaví účet Instagram Professional prepojený s vašou Facebook stránkou. Stránka a Instagram sa správajú ako jeden zjednotený konektor a monitorovanie Instagramu je iba na čítanie.",
        ],
      },
    ],
    faqs: [{ q: "Pripájam Instagram samostatne?", a: "Nie — objaví sa cez jeho prepojenú Facebook stránku." }],
  },
  "roles-and-permissions": {
    title: "Roly a oprávnenia",
    metaTitle: "Roly a oprávnenia — dokumentácia Tamanoru",
    summary:
      "Pochopte roly v pracovnom priestore Tamanoru a to, ako oprávnenie platformy spolu s oprávnením roly spoločne rozhodujú, ktoré akcie sú dostupné.",
    keywords: ["roly a oprávnenia", "dokumentácia rbac", "roly v pracovnom priestore"],
    sections: [
      {
        heading: "Dve vrstvy oprávnení",
        body: [
          "Oprávnenie platformy (čo umožňuje OAuth grant) aj rola v pracovnom priestore (čo umožňuje vaša rola) musia akciu povoliť skôr, než sa ponúkne. Schvaľovanie je obmedzené na autorizované roly.",
        ],
      },
    ],
    faqs: [{ q: "Môžem obmedziť, kto schvaľuje akcie?", a: "Áno — schvaľovanie je obmedzené na roly, ktorým ho udelíte." }],
  },
  "webhooks": {
    title: "Webhooky",
    metaTitle: "Webhooky — dokumentácia Tamanoru",
    summary:
      "Tamanor overuje podpisy webhookov, deduplikuje doručenia, smeruje udalosti Facebooku a Instagramu cez jeden konektor a nájomníka určuje z pripojeného účtu.",
    keywords: ["dokumentácia webhookov", "podpis webhooku", "meta webhooky", "instagram webhooky"],
    sections: [
      {
        heading: "Podpísané, deduplikované, bezpečné voči nájomníkom",
        body: [
          "Každá prichádzajúca udalosť sa overuje podpisom; spracujú sa iba platné udalosti. Deduplikačný kľúč odmieta opakovania. Nájomník sa vždy odvodzuje zo zhodujúceho sa účtu, nikdy z payloadu.",
        ],
      },
    ],
    faqs: [{ q: "Spracúvajú sa nepodpísané webhooky?", a: "Nie — ukladajú sa na účely auditu, ale nikdy sa nespracujú." }],
  },
  "security-overview": {
    title: "Prehľad bezpečnosti",
    metaTitle: "Prehľad bezpečnosti — dokumentácia Tamanoru",
    summary:
      "Stručný technický prehľad bezpečnostného postoja Tamanoru: iba OAuth, iba na čítanie v predvolenom nastavení, šifrované tokeny, izolácia nájomníkov na úrovni riadkov a auditný log, do ktorého sa len pridáva.",
    keywords: ["prehľad bezpečnosti", "dokumentácia bezpečnosti", "bezpečnosť oauth", "rls"],
    sections: [
      {
        heading: "To podstatné",
        body: [
          "Iba oficiálny OAuth; žiadny scraping; žiadne heslá. Tokeny šifrované v pokoji a držané mimo logov. Zabezpečenie na úrovni riadkov izoluje nájomníkov. Každá akcia je auditovaná. Iba na čítanie v predvolenom nastavení s akciami schválenými človekom.",
        ],
      },
    ],
    faqs: [{ q: "Kde je celá stránka o bezpečnosti?", a: "Verejná stránka o bezpečnosti zhŕňa dôveru a bezpečnosť; tento dokument je jej technickým doplnkom." }],
  },
  "manual-moderation": {
    title: "Tamanor vs. manuálne moderovanie",
    metaTitle: "Tamanor vs. manuálne moderovanie — porovnanie prístupov",
    summary:
      "Ako sa centralizovaný, auditovaný firewall s konzistentnými pravidlami porovnáva s ručnou kontrolou každej platformy. Porovnanie pracovného postupu — žiadne číselné úspory času sa nenárokujú.",
    keywords: ["manuálne moderovanie", "pracovný postup sociálneho moderovania", "centralizovaná schránka", "auditná stopa"],
    sections: [
      {
        heading: "Čo sa mení",
        body: [
          "Manuálne moderovanie znamená otvárať každú platformu a čítať komentáre ručne: pokrytie závisí od toho, kto a kedy sleduje, pravidlá sídlia v hlavách ľudí a neexistuje jednotný záznam o tom, čo sa rozhodlo.",
          "Tamanor centralizuje monitorované komentáre a recenzie na jedno miesto, na každú položku aplikuje tie isté pravidlá značky a AI detekciu rizika a každú akciu zaznamenáva do auditného logu, do ktorého sa len pridáva — takže rozhodnutia sú konzistentné a preskúmateľné namiesto náhodných.",
        ],
      },
      {
        heading: "Čestné limity",
        body: [
          "Tamanor stále drží človeka v slučke: pripravuje návrhy a človek ich schvaľuje. Nenárokuje si, že odstráni úsilie pri kontrole ani že zaručí, že nič nikdy neunikne — robí pokrytie systematickým a auditovateľným. Nenárokuje sa žiadne konkrétne percento ušetreného času, pretože to závisí od vášho objemu.",
        ],
      },
    ],
    faqs: [
      { q: "Nahrádza Tamanor ľudských recenzentov?", a: "Nie. Centralizuje a prioritizuje prácu; človek stále schvaľuje každú akciu." },
      { q: "Nárokujete si konkrétnu úsporu času?", a: "Nie — akékoľvek číslo by záviselo od vášho objemu komentárov a tímu, takže žiadne nezverejňujeme." },
    ],
  },
  "separate-social-tools": {
    title: "Tamanor vs. samostatné nástroje pre jednotlivé platformy",
    metaTitle: "Tamanor vs. samostatné sociálne nástroje — porovnanie prístupov",
    summary:
      "Ako sa model neutrálny voči poskytovateľovi so zdieľanými pravidlami rizika a jedným auditom porovnáva so zošívaním samostatných rozhraní pre jednotlivé platformy. Porovnanie pracovného postupu.",
    keywords: ["samostatné sociálne nástroje", "neutrálny voči poskytovateľovi", "zjednotené moderovanie", "naprieč platformami"],
    sections: [
      {
        heading: "Čo sa mení",
        body: [
          "Používanie iného rozhrania pre každú platformu rozdrobí pravidlá, hodnotenie rizika a históriu naprieč nástrojmi. Každý nástroj vidí iba svoju platformu a to, čo akcia znamená, sa líši nástroj od nástroja.",
          "Tamanor normalizuje komentáre a recenzie do jedného modelu neutrálneho voči poskytovateľovi, aplikuje zdieľané pravidlá rizika a sentimentu a drží jeden audit — pričom stále rešpektuje skutočné schopnosti každého poskytovateľa (akcia, ktorú platforma nedokáže vykonať, sa nikdy neponúkne).",
        ],
      },
    ],
    faqs: [
      { q: "Znamená jeden model, že každá platforma sa správa rovnako?", a: "Nie — Tamanor ctí skutočné limity schopností každého poskytovateľa; model je zjednotený, schopnosti sú čestné pre každú platformu." },
    ],
  },
  "autonomous-ai-moderation": {
    title: "Tamanor vs. autonómne AI moderovanie",
    metaTitle: "Človek v slučke vs. autonómne AI moderovanie",
    summary:
      "Tamanor má človeka v slučke, nie je autonómny: AI deteguje a navrhuje, uplatňujú sa pravidlá a brány schopností a človek schvaľuje pred akoukoľvek akciou. Vykonávanie je fail-closed.",
    keywords: ["autonómne ai moderovanie", "človek v slučke", "pracovný postup schvaľovania", "fail closed"],
    sections: [
      {
        heading: "Skutočný rozdiel",
        body: [
          "Plne autonómny systém rozhoduje a koná sám. Tamanor to zámerne nerobí: automatické vykonávanie je vypnuté. AI vytvorí hodnotenie rizika a navrhovanú akciu; uplatňujú sa pravidlá značky, pracovný postup schvaľovania, kontroly schopností platformy a brány stavu konektora; a človek schváli skôr, než sa čokoľvek dotkne platformy.",
          "Vykonávanie je fail-closed — ak v čase vykonania chýba schopnosť alebo oprávnenie, akcia bezpečne zlyhá a je auditovaná namiesto pretlačenia. Tamanor nie je a ani sa neprezentuje ako plne autonómny moderátor.",
        ],
      },
    ],
    faqs: [
      { q: "Môžem povoliť plne automatické skrývanie?", a: "Nie. Automatické vykonávanie je zámerne nedostupné; návrhy sa pripravujú na schválenie človekom." },
      { q: "Je Tamanor autonómny AI agent?", a: "Nie. Je navrhnutý s človekom v slučke; autoExecution je vypnuté." },
    ],
  },
  "unified-brand-inbox": {
    title: "Tamanor vs. samostatné rozhrania Facebook/Instagram/Google",
    metaTitle: "Zjednotená schránka značky vs. samostatné rozhrania poskytovateľov",
    summary:
      "Ako sa jedna normalizovaná schránka pre komentáre a recenzie porovnáva so samostatnými rozhraniami poskytovateľov — s čestnými limitmi schopností pre jednotlivých poskytovateľov a pravdivými stavmi konektorov.",
    keywords: ["zjednotená schránka značky", "sociálna schránka", "komentáre vs recenzie", "stav konektora"],
    sections: [
      {
        heading: "Čo sa mení",
        body: [
          "Samostatné rozhrania poskytovateľov znamenajú prepínanie kontextu medzi Facebookom, Instagramom a Google, každé s vlastným pohľadom na komentáre alebo recenzie. Tamanor prináša monitorované položky do jednej normalizovanej schránky so zdieľaným kontextom rizika a rozlišuje komentáre od recenzií.",
          "Dostupnosť je čestná: každý poskytovateľ zobrazuje svoj skutočný stav konektora a dnes je živo overený iba Facebook. Instagram a Google Business sa zobrazujú so svojím skutočným stavom (čaká na overenie), nikdy nie ako živé.",
        ],
      },
    ],
    faqs: [
      { q: "Sú v schránke všetci poskytovatelia živí?", a: "Nie. Facebook je živo overený; Instagram a Google Business sa zobrazujú so svojím skutočným stavom čakania na overenie." },
    ],
  },
  "reputation-management-platform-checklist": {
    title: "Kontrolný zoznam platformy na správu reputácie",
    metaTitle: "Kontrolný zoznam platformy reputácie — neutrálne hodnotenie",
    summary:
      "Neutrálny kontrolný zoznam kupujúceho na hodnotenie akejkoľvek platformy na správu reputácie/moderovanie s čestným stavom Tamanoru pri každej položke — vrátane toho, čo ešte nie je hotové.",
    keywords: ["kontrolný zoznam správy reputácie", "kritériá hodnotenia", "kontrolný zoznam kupujúceho", "platforma na moderovanie"],
    sections: [
      {
        heading: "Ako toto použiť",
        body: [
          "Toto sú kritériá neutrálne voči poskytovateľovi na hodnotenie akejkoľvek platformy. Každý riadok uvádza čestný stav Tamanoru; tam, kde niečo ešte nie je hotové, to povie namiesto naznačovania úplnosti.",
        ],
      },
      {
        heading: "Bezpečnosť a dáta",
        body: [
          "Izolácia nájomníkov — áno: zabezpečenie na úrovni riadkov v PostgreSQL izoluje každého nájomníka na úrovni databázy.",
          "Audit — áno: auditný log obmedzený na nájomníka, do ktorého sa len pridáva, bez tajomstiev.",
          "Šifrovanie tokenov — áno: OAuth tokeny šifrované v pokoji v produkcii; ukladanie v otvorenom texte je v produkcii blokované.",
          "Brány oprávnení — áno: akciu musia povoliť schopnosť platformy aj rola v pracovnom priestore.",
          "Vlastníctvo dát — áno: dáta zákazníka sú izolované pre každého nájomníka a nezdieľajú sa ani nepredávajú.",
          "Rotácia kľúčov — zatiaľ nie: rotácia kľúča na šifrovanie tokenov zostáva medzerou v pláne rozvoja.",
          "Kontroly exportu / uchovávania — zatiaľ nie: samoobslužný export a politiky uchovávania nie sú implementované.",
        ],
      },
      {
        heading: "Pracovný postup a prevádzka",
        body: [
          "Pracovný postup schvaľovania — áno: schválenie človekom pred akoukoľvek akciou; fail-closed vykonávanie.",
          "Stav poskytovateľa — áno: čestné stavy stavu/oprávnení konektora, žiadna falošná zelená.",
          "Životný cyklus odpojenia — áno: odpojenie odstráni lokálne tokeny; odvolanie u poskytovateľa je best-effort.",
          "Perzistencia pracovného postupu — áno: návrhy, schválenia a výsledky pretrvávajú a sú auditovateľné.",
          "Stránkovanie / škálovateľnosť — áno: synchronizácie čítania stránkujú kurzormi a sú idempotentné.",
          "Overenie poskytovateľa — čiastočne: Facebook je živo overený; Instagram a Google Business čakajú na overenie; YouTube/LinkedIn/TikTok sú vo výskume.",
        ],
      },
    ],
    faqs: [
      { q: "Spĺňa Tamanor každú položku?", a: "Nie — rotácia kľúčov a export/uchovávanie výslovne ešte nie sú hotové a viacero poskytovateľov čaká na overenie. Kontrolný zoznam každú položku uvádza čestne." },
    ],
  },
  "tenant-isolation": {
    title: "Izolácia nájomníkov",
    metaTitle: "Izolácia nájomníkov — bezpečnosť Tamanoru",
    summary:
      "Tamanor vymedzuje každú reláciu a dotaz na jedného aktívneho nájomníka, vrstvi aplikačné kontroly oprávnení nad zabezpečenie databázy na úrovni riadkov a systémový a runtime prístup k databáze drží oddelene.",
    keywords: ["izolácia nájomníkov", "multi-tenant bezpečnosť", "aktívny nájomník", "runtime rls"],
    sections: [
      {
        heading: "Jeden aktívny nájomník, vynútený dvakrát",
        body: [
          "Relácie sú vymedzené na nájomníka: požiadavka nesie práve jedného aktívneho nájomníka. Aplikačné kontroly oprávnení rozhodujú, čo smie člen robiť, a zabezpečenie na úrovni riadkov v PostgreSQL vynucuje, ktoré riadky pre daného nájomníka existujú na úrovni databázy.",
          "Systémová práca naprieč nájomníkmi (objavovanie a čistenie workerom) používa samostatnú, úzku prístupovú cestu, ktorá sa nikdy nepoužíva pri bežnej požiadavke nájomníka. Runtime klient nájomníka a systémový klient sú návrhovo odlišné.",
        ],
      },
    ],
    faqs: [{ q: "Môže jeden zákazník vidieť dáta druhého?", a: "Nie. Izoláciu vynucuje zabezpečenie na úrovni riadkov na úrovni databázy, nielen aplikačný kód." }],
  },
  "authentication": {
    title: "Autentifikácia a relácie",
    metaTitle: "Autentifikácia — relácie v Tamanore",
    summary:
      "Tamanor používa nepriehľadné relácie s tokenom hašovaným v databáze, ktoré podporujú odvolanie, vypršanie a zneplatnenie pri odhlásení.",
    keywords: ["autentifikácia", "nepriehľadná relácia", "odvolanie relácie", "odhlásenie"],
    sections: [
      {
        heading: "Nepriehľadné, odvolateľné relácie",
        body: [
          "Relácia je nepriehľadný token; databáza ukladá iba jeho haš, nikdy nie surový token. Relácie vypršia, dajú sa odvolať a pri odhlásení sa zneplatnia. Kontroly na strane servera vynucujú autentifikáciu pri každej chránenej ceste a akcii.",
        ],
      },
    ],
    faqs: [{ q: "Ukladá sa surový token relácie?", a: "Nie — ukladá sa iba haš, takže databáza nikdy nedrží použiteľný token." }],
  },
  "provider-tokens": {
    title: "Tokeny poskytovateľov",
    metaTitle: "Tokeny poskytovateľov — bezpečnosť tokenov v Tamanore",
    summary:
      "OAuth tokeny poskytovateľov sú šifrované v pokoji, pri odpojení lokálne odstránené a u poskytovateľa odvolané na báze best-effort; rotácia kľúčov zostáva medzerou v pláne rozvoja.",
    keywords: ["tokeny poskytovateľov", "bezpečnosť oauth tokenov", "šifrovanie v pokoji", "odvolanie tokenov"],
    sections: [
      {
        heading: "Ako sa nakladá s tokenmi",
        body: [
          "OAuth tokeny sú v produkcii šifrované v pokoji a nikdy sa nezobrazujú, nezapisujú do logov ani neumiestňujú do auditnej stopy. Odpojenie účtu odstráni uložený token lokálne; odvolanie u poskytovateľa sa pokúša na báze best-effort.",
          "Čestná medzera: automatizovaná rotácia kľúčov na šifrovanie tokenov ešte nie je implementovaná a zostáva v pláne rozvoja.",
        ],
      },
    ],
    faqs: [{ q: "Je implementovaná rotácia kľúčov?", a: "Zatiaľ nie — šifrovanie v pokoji je zavedené, ale automatizovaná rotácia kľúčov je zostávajúcou medzerou v pláne rozvoja." }],
  },
  "audit-logging": {
    title: "Auditné logovanie",
    metaTitle: "Auditné logovanie — bezpečnosť Tamanoru",
    summary:
      "Tamanor zapisuje auditný log obmedzený na nájomníka, do ktorého sa len pridáva; odkazy na aktérov používajú životný cyklus SetNull, takže história prežije odstránenie používateľa, a tokeny sa nikdy nelogujú.",
    keywords: ["auditné logovanie", "len pridávanie", "životný cyklus aktéra", "žiadne logovanie tokenov"],
    sections: [
      {
        heading: "Len pridávanie, bez tajomstiev",
        body: [
          "Zmysluplné akcie sa zaznamenávajú len pridávaním a sú obmedzené na nájomníka. Odkazy na aktérov používajú životný cyklus SetNull, takže odstránenie používateľa nevymaže historický záznam. V auditnom zázname sa nikdy nezobrazí žiadny token, heslo ani connection string.",
        ],
      },
    ],
    faqs: [{ q: "Obsahujú auditné záznamy niekedy tokeny?", a: "Nie — tajomstvá sú odstránené; auditný log nikdy neobsahuje materiál tokenov." }],
  },
  "data-integrity": {
    title: "Integrita dát",
    metaTitle: "Integrita dát — bezpečnosť Tamanoru",
    summary:
      "Tamanor perzistuje obsah a reputáciu atomicky, prijíma idempotentne, používa leasey na úrovni účtu a vynucuje referenčnú integritu, aby zabránil osirotelým záznamom.",
    keywords: ["integrita dát", "atomický zápis", "idempotentné prijímanie", "referenčná integrita"],
    sections: [
      {
        heading: "Konzistentné už z podstaty",
        body: [
          "Každý kus obsahu a jeho reputačný záznam sa zapisujú v jednej atomickej transakcii. Prijímanie je idempotentné, takže rovnaká položka sa nikdy neduplikuje. Lease na úrovni účtu zabraňuje prekrývajúcim sa synchronizáciám a referenčná integrita zabraňuje osirotelým záznamom.",
        ],
      },
    ],
    faqs: [{ q: "Môže synchronizácia vytvoriť duplikáty?", a: "Nie — prijímanie je idempotentné na jedinečnom kľúči, takže opätovné spracovanie položky ju deduplikuje." }],
  },
  "webhook-security": {
    title: "Bezpečnosť webhookov",
    metaTitle: "Bezpečnosť webhookov — Tamanor",
    summary:
      "Tamanor overuje podpisy webhookov, deduplikuje opakovania, nájomníka odvodzuje z pripojeného účtu (nikdy z payloadu) a neplatné webhooky ukladá iba na účely auditu — nikdy ich nespracuje.",
    keywords: ["bezpečnosť webhookov", "overenie podpisu", "ochrana proti opakovaniu", "odvodenie nájomníka"],
    sections: [
      {
        heading: "Dôveryhodné už z podstaty",
        body: [
          "Prichádzajúce webhooky sa overujú podpisom; spracujú sa iba platné udalosti. Stabilný deduplikačný kľúč odmieta opakovania. Nájomník sa odvodzuje zo zhodujúceho sa pripojeného účtu, nikdy z payloadu, takže vyrobené telo nemôže prekročiť hranice medzi nájomníkmi. Neplatné alebo nepodpísané udalosti sa ukladajú na účely auditu, ale nikdy sa nespracujú.",
        ],
      },
    ],
    faqs: [{ q: "Koná sa na základe nepodpísaných webhookov?", a: "Nie — ukladajú sa iba na účely auditu a nikdy sa nespracujú." }],
  },
  "responsible-ai": {
    title: "Zodpovedná AI",
    metaTitle: "Zodpovedná AI — Tamanor",
    summary:
      "AI Tamanoru má človeka v slučke: deteguje a navrhuje pod pravidlami značky a bránami schopností poskytovateľa, s krokom schválenia a fail-closed vykonávaním — nikdy nie neobmedzená autonómia.",
    keywords: ["zodpovedná ai", "človek v slučke", "riadenie ai", "brány schopností"],
    sections: [
      {
        heading: "AI navrhuje, ľudia rozhodujú",
        body: [
          "AI vytvára iba hodnotenia rizika a návrhy. Uplatňujú sa pravidlá značky, pracovný postup schvaľovania a brány schopností poskytovateľa a vykonávanie je fail-closed. Automatické vykonávanie je vypnuté; Tamanor nie je neobmedzený autonómny agent.",
        ],
      },
    ],
    faqs: [{ q: "Koná AI sama?", a: "Nie — navrhuje; človek schvaľuje a vykonávanie je podmienené schopnosťami a fail-closed." }],
  },
  "disclosure": {
    title: "Bezpečnostné oznámenie",
    metaTitle: "Bezpečnostné oznámenie — Tamanor",
    summary:
      "Ako nahlásiť bezpečnostnú obavu Tamanoru. Hlásenia sa dostanú k tímu cez kontaktný kanál; vyhradená bezpečnostná adresa je konfigurovateľná pred produkciou.",
    keywords: ["bezpečnostné oznámenie", "zodpovedné zverejnenie", "nahlásenie zraniteľnosti", "bezpečnostný kontakt"],
    sections: [
      {
        heading: "Nahlásenie obavy",
        body: [
          "Ak sa domnievate, že ste našli bezpečnostný problém, kontaktujte tím cez kontaktnú stránku. Žiadame nahlasovateľov, aby sa vyhli prístupu k dátam iných používateľov alebo ich úprave a aby nám dali rozumnú príležitosť reagovať pred verejným zverejnením.",
          "Vyhradená bezpečnostná schránka je konfigurovateľná pred produkciou; kým sa neoznámi, autoritatívnou cestou je kontaktný kanál. Tamanor nezverejňuje zástupnú adresu, ktorá nie je monitorovaná.",
        ],
      },
    ],
    faqs: [
      { q: "Kam nahlásim zraniteľnosť?", a: "Použite kontaktnú stránku. Vyhradená bezpečnostná adresa je konfigurovateľná pred produkciou a bude oznámená, keď bude v prevádzke." },
    ],
  },
};
