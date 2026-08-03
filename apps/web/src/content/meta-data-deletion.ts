/**
 * META-EXTERNAL-ACCESS-V1 — public status page copy for the Meta data-deletion callback.
 *
 * STRICTLY FACTUAL. Every statement here describes behaviour that is implemented and testable in this
 * repository — see `apps/web/src/app/api/meta/data-deletion/route.ts` and
 * `packages/db/src/meta-identity-deletion.ts`. It contains NO legal claim, NO promise beyond what the code
 * does, and NO invented policy: rights and contact details live in the existing Privacy Policy and Data
 * Subject Rights Policy, which this page links to rather than restating.
 */
import type { LegalDoc } from "./legal";
import type { Locale } from "@/i18n";

const en: LegalDoc = {
  metaTitle: "Facebook data deletion status | Tamanor",
  metaDescription: "Status of a Facebook data deletion request received by Tamanor.",
  eyebrow: "Data deletion",
  title: "Facebook data deletion status",
  subtitle: "What happens when Facebook sends us a data deletion request for your account.",
  updated: "",
  sections: [
    {
      title: "1. Status of your request",
      blocks: [
        { type: "p", text: "Deletion requests received from Facebook are processed at the moment they arrive. If you were given a confirmation code, the request carrying that code has already been processed — there is no queue and no waiting period." },
        { type: "p", text: "The confirmation code identifies the request only. It is derived from your Facebook account identifier in a way that cannot be reversed, and it is not stored alongside your name, e-mail address or any other personal detail." },
      ],
    },
    {
      title: "2. What is removed",
      blocks: [
        { type: "p", text: "Tamanor removes the link between your Facebook account and your Tamanor sign-in. After this, signing in with Facebook no longer identifies you to Tamanor." },
      ],
    },
    {
      title: "3. What is not removed, and why",
      blocks: [
        { type: "p", text: "Your Tamanor user account is not deleted. It may also be accessible by e-mail and password or another sign-in method, and it may belong to a workspace shared with other people." },
        { type: "p", text: "Connected Facebook Pages, Instagram accounts, stored credentials and business contacts are not deleted. A connected Page records the Page itself, not which Facebook user authorised the connection, so a deletion request for one person cannot be attributed to a Page that a whole organisation depends on." },
        { type: "p", text: "To remove a connected Page, use Disconnect inside Tamanor. To request deletion of your Tamanor account or workspace data, follow the Data Subject Rights Policy." },
      ],
    },
    {
      title: "4. Further requests",
      blocks: [
        { type: "p", text: "See the Privacy Policy and the Data Subject Rights Policy for the full description of what Tamanor processes and how to exercise your rights, including the contact address for such requests." },
      ],
    },
  ],
};

const sk: LegalDoc = {
  metaTitle: "Stav vymazania údajov z Facebooku | Tamanor",
  metaDescription: "Stav žiadosti o vymazanie údajov z Facebooku prijatej službou Tamanor.",
  eyebrow: "Vymazanie údajov",
  title: "Stav vymazania údajov z Facebooku",
  subtitle: "Čo sa stane, keď nám Facebook pošle žiadosť o vymazanie údajov k vášmu účtu.",
  updated: "",
  sections: [
    {
      title: "1. Stav vašej žiadosti",
      blocks: [
        { type: "p", text: "Žiadosti o vymazanie prijaté z Facebooku spracúvame v okamihu ich doručenia. Ak ste dostali potvrdzovací kód, žiadosť s týmto kódom už bola spracovaná — neexistuje žiadny front ani čakacia lehota." },
        { type: "p", text: "Potvrdzovací kód identifikuje iba samotnú žiadosť. Je odvodený z identifikátora vášho facebookového účtu spôsobom, ktorý nemožno zvrátiť, a neuchováva sa spolu s vaším menom, e-mailovou adresou ani iným osobným údajom." },
      ],
    },
    {
      title: "2. Čo sa odstráni",
      blocks: [
        { type: "p", text: "Tamanor odstráni prepojenie medzi vaším facebookovým účtom a vaším prihlásením do služby Tamanor. Po tomto kroku vás prihlásenie cez Facebook v službe Tamanor už neidentifikuje." },
      ],
    },
    {
      title: "3. Čo sa neodstráni a prečo",
      blocks: [
        { type: "p", text: "Váš používateľský účet Tamanor sa nevymaže. Môže byť prístupný aj cez e-mail a heslo alebo iný spôsob prihlásenia a môže patriť do pracovného priestoru zdieľaného s ďalšími osobami." },
        { type: "p", text: "Pripojené facebookové stránky, instagramové účty, uložené poverenia a obchodné kontakty sa nevymažú. Pripojená stránka eviduje samotnú stránku, nie to, ktorý facebookový používateľ pripojenie autorizoval, takže žiadosť jednej osoby nemožno priradiť k stránke, na ktorej závisí celá organizácia." },
        { type: "p", text: "Na odstránenie pripojenej stránky použite funkciu Odpojiť priamo v službe Tamanor. Vymazanie účtu Tamanor alebo údajov pracovného priestoru si vyžiadajte podľa Zásad práv dotknutých osôb." },
      ],
    },
    {
      title: "4. Ďalšie žiadosti",
      blocks: [
        { type: "p", text: "Úplný opis toho, čo Tamanor spracúva, a spôsob uplatnenia vašich práv vrátane kontaktnej adresy nájdete v Zásadách ochrany osobných údajov a v Zásadách práv dotknutých osôb." },
      ],
    },
  ],
};

const de: LegalDoc = {
  metaTitle: "Status der Facebook-Datenlöschung | Tamanor",
  metaDescription: "Status einer bei Tamanor eingegangenen Facebook-Löschanfrage.",
  eyebrow: "Datenlöschung",
  title: "Status der Facebook-Datenlöschung",
  subtitle: "Was geschieht, wenn Facebook uns eine Löschanfrage zu Ihrem Konto sendet.",
  updated: "",
  sections: [
    {
      title: "1. Status Ihrer Anfrage",
      blocks: [
        { type: "p", text: "Von Facebook eingehende Löschanfragen werden im Moment ihres Eingangs verarbeitet. Wenn Sie einen Bestätigungscode erhalten haben, wurde die zugehörige Anfrage bereits verarbeitet — es gibt keine Warteschlange und keine Wartezeit." },
        { type: "p", text: "Der Bestätigungscode identifiziert ausschließlich die Anfrage. Er wird aus Ihrer Facebook-Kontokennung auf nicht umkehrbare Weise abgeleitet und wird nicht zusammen mit Ihrem Namen, Ihrer E-Mail-Adresse oder anderen personenbezogenen Angaben gespeichert." },
      ],
    },
    {
      title: "2. Was entfernt wird",
      blocks: [
        { type: "p", text: "Tamanor entfernt die Verknüpfung zwischen Ihrem Facebook-Konto und Ihrer Tamanor-Anmeldung. Danach identifiziert Sie eine Anmeldung über Facebook bei Tamanor nicht mehr." },
      ],
    },
    {
      title: "3. Was nicht entfernt wird und warum",
      blocks: [
        { type: "p", text: "Ihr Tamanor-Benutzerkonto wird nicht gelöscht. Es kann auch per E-Mail und Passwort oder über eine andere Anmeldemethode zugänglich sein und zu einem Arbeitsbereich gehören, der mit anderen Personen geteilt wird." },
        { type: "p", text: "Verbundene Facebook-Seiten, Instagram-Konten, gespeicherte Anmeldedaten und Geschäftskontakte werden nicht gelöscht. Eine verbundene Seite erfasst die Seite selbst, nicht welcher Facebook-Nutzer die Verbindung autorisiert hat; eine Löschanfrage einer einzelnen Person kann daher keiner Seite zugeordnet werden, von der eine ganze Organisation abhängt." },
        { type: "p", text: "Um eine verbundene Seite zu entfernen, verwenden Sie in Tamanor die Funktion Trennen. Die Löschung Ihres Tamanor-Kontos oder der Arbeitsbereichsdaten beantragen Sie gemäß der Richtlinie zu Betroffenenrechten." },
      ],
    },
    {
      title: "4. Weitere Anfragen",
      blocks: [
        { type: "p", text: "Die vollständige Beschreibung der von Tamanor verarbeiteten Daten sowie die Ausübung Ihrer Rechte einschließlich der Kontaktadresse finden Sie in der Datenschutzerklärung und in der Richtlinie zu Betroffenenrechten." },
      ],
    },
  ],
};

export const metaDataDeletionStatus: Record<Locale, LegalDoc> = { en, sk, de };
