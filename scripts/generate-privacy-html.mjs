import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Mirrors src/data/privacyPolicy.ts for the static AdSense URL. */
const sr = {
  updated: '23. jul 2026.',
  intro:
    'Ova Politika privatnosti objašnjava kako Obračun (Transport Cost) na domenu transportcost.info prikuplja, koristi i štiti lične podatke kada koristite naš kalkulator putarine i troškova transporta, pretplatu i povezane usluge.',
  sections: [
    {
      title: '1. Ko smo mi',
      paragraphs: [
        'Operater usluge je Obračun / Transport Cost („mi“, „nas“), veb-aplikacija dostupna na https://transportcost.info/ i povezanim hosting domenima (npr. transportcost.web.app).',
        'Kontakt za privatnost i podršku: support@transportcost.info',
      ],
    },
    {
      title: '2. Koje podatke prikupljamo',
      paragraphs: [
        'Podaci o nalogu: kada se prijavite putem Google naloga, dobijamo identifikatore koje Google deli (npr. ID korisnika, ime, e-mail adresu) radi autentifikacije i vođenja naloga.',
        'Podaci o korišćenju usluge: broj izračunavanja, status pretplate / kvote, podešavanja troškova i popusta koja sačuvate u nalogu, kao i tehnički podaci potrebni za rad aplikacije (npr. vremenske oznake zahteva).',
        'Unosi rute: adrese, koordinate i parametri vozila koje unesete radi proračuna. Oni se šalju partnerima za mapiranje i rute (Google Places / Maps, HERE) kako bi se dobila ruta i procena putarine.',
        'Plaćanja: pretplate se obrađuju preko PayPal-a. Mi ne čuvamo podatke o Vašoj platnoj kartici; PayPal nam šalje status pretplate i identifikatore transakcije potrebne za aktivaciju paketa.',
        'Prijave grešaka: ako pošaljete bug report, primamo Vašu e-mail adresu i tekst poruke radi podrške.',
        'Oglasi i saglasnost: na sajtu se prikazuju Google AdSense oglasi. Za korisnike u EEA, UK i Švajcarskoj koristimo Google-ov CMP (Privacy & messaging) radi prikupljanja saglasnosti u skladu sa propisima.',
      ],
    },
    {
      title: '3. Zašto obrađujemo podatke',
      paragraphs: [
        'Da pružimo kalkulator, nalog, pretplatu i kvotu izračunavanja.',
        'Da obradimo plaćanja i upravljamo pretplatom (uključujući otkazivanje i promenu paketa).',
        'Da prikažemo oglase (uključujući personalizovane, ako ste dali saglasnost) i merimo njihov učinak.',
        'Da odgovorimo na zahteve za podršku i poboljšamo pouzdanost usluge.',
        'Da ispunimo zakonske obaveze i sprečimo zloupotrebu.',
      ],
    },
    {
      title: '4. Pravni osnov (EEA / UK / Švajcarska)',
      paragraphs: [
        'Gde se primenjuje GDPR ili slični propisi, obradu zasnivamo na: izvršenju ugovora (pružanje usluge i pretplate), legitimnom interesu (bezbednost, osnovna analitika rada usluge), saglasnosti (npr. oglašavanje / kolačići gde je to potrebno) i zakonskim obavezama.',
        'Saglasnost za oglase i određene kolačiće možete dati ili povući putem Google CMP poruke („Consent“, „Do not consent“, „Manage options“) kada se prikaže.',
      ],
    },
    {
      title: '5. Sa kime delimo podatke',
      paragraphs: [
        'Google (prijava, Firebase Auth / Firestore / Hosting / Cloud Functions, AdSense, eventualno Consent Mode).',
        'HERE Technologies (rute i putarine van Srbije, gde je primenjivo).',
        'PayPal (plaćanja i pretplate).',
        'Resend ili sličan e-mail provajder (dostava bug reportova na našu adresu podrške), kada je konfigurisano.',
        'Ne prodajemo Vaše lične podatke.',
      ],
    },
    {
      title: '6. Kolačići i slične tehnologije',
      paragraphs: [
        'Koristimo neophodne tehnologije za prijavu i rad aplikacije, kao i oglašivačke / merne kolačiće Google AdSense-a gde je to dozvoljeno Vašom saglasnošću ili važećim pravilima.',
        'Detalje o oglašivačkim partnerima i izborima možete upravljati kroz Google CMP na sajtu i kroz podešavanja Vašeg pregledača.',
      ],
    },
    {
      title: '7. Čuvanje podataka',
      paragraphs: [
        'Podaci naloga i pretplate čuvaju se dok je nalog aktivan i onoliko koliko je potrebno za pružanje usluge, računovodstvo i zakonske obaveze.',
        'Bug reportovi se čuvaju onoliko koliko je potrebno za rešavanje prijave.',
        'Podaci o ruti se obrađuju radi izračuna; ne gradimo marketing profile od Vaših ruta.',
      ],
    },
    {
      title: '8. Međunarodni transferi',
      paragraphs: [
        'Pružaoci usluga (npr. Google, PayPal, HERE) mogu obrađivati podatke van Srbije / EEA. Gde je primenjivo, oslanjamo se na odgovarajuće zaštitne mere tih pružalaca (npr. standardne ugovorne klauzule).',
      ],
    },
    {
      title: '9. Vaša prava',
      paragraphs: [
        'U zavisnosti od primenjivog prava, možete zatražiti pristup, ispravku, brisanje, ograničenje obrade, prenosivost ili prigovor, kao i povlačenje saglasnosti.',
        'Za zahteve pišite na support@transportcost.info. Možete i da se odjavite / obrišete sesiju u aplikaciji; za potpuno brisanje naloga kontaktirajte nas e-mailom.',
        'Ako ste u EEA/UK, imate pravo na žalbu nadzornom organu za zaštitu podataka.',
      ],
    },
    {
      title: '10. Deca',
      paragraphs: [
        'Usluga nije namenjena deci mlađoj od 16 godina. Ne prikupljamo svesno podatke o deci.',
      ],
    },
    {
      title: '11. Izmene',
      paragraphs: [
        'Ovu politiku možemo povremeno ažurirati. Datum poslednje izmene objavljujemo na ovoj stranici. Nastavak korišćenja usluge nakon izmene znači da ste upoznati sa ažuriranom politikom, osim gde je potrebna nova saglasnost.',
      ],
    },
  ],
}

const en = {
  updated: '23 July 2026',
  intro:
    'This Privacy Policy explains how Obračun (Transport Cost) at transportcost.info collects, uses, and protects personal data when you use our toll and transport cost calculator, subscription, and related services.',
  sections: [
    {
      title: '1. Who we are',
      paragraphs: [
        'The service is operated by Obračun / Transport Cost (“we”, “us”), a web application available at https://transportcost.info/ and related hosting domains (e.g. transportcost.web.app).',
        'Privacy and support contact: support@transportcost.info',
      ],
    },
    {
      title: '2. Data we collect',
      paragraphs: [
        'Account data: when you sign in with Google, we receive identifiers Google shares (such as user ID, name, and email) for authentication and account management.',
        'Service usage data: calculation counts, subscription / quota status, cost and discount settings stored on your account, and technical data needed to run the app (e.g. request timestamps).',
        'Route inputs: addresses, coordinates, and vehicle parameters you enter for a calculation. These are sent to mapping and routing partners (Google Places / Maps, HERE) to obtain a route and toll estimate.',
        'Payments: subscriptions are processed by PayPal. We do not store your card details; PayPal sends us subscription status and transaction identifiers needed to activate a plan.',
        'Bug reports: if you submit a bug report, we receive your email address and message text for support.',
        'Ads and consent: the site shows Google AdSense ads. For users in the EEA, UK, and Switzerland we use Google’s CMP (Privacy & messaging) to collect consent where required.',
      ],
    },
    {
      title: '3. Why we process data',
      paragraphs: [
        'To provide the calculator, account, subscription, and calculation quota.',
        'To process payments and manage subscriptions (including cancellation and plan changes).',
        'To show ads (including personalized ads if you consented) and measure ad performance.',
        'To respond to support requests and improve reliability.',
        'To meet legal obligations and prevent abuse.',
      ],
    },
    {
      title: '4. Legal bases (EEA / UK / Switzerland)',
      paragraphs: [
        'Where GDPR or similar rules apply, we rely on: performance of a contract (providing the service and subscription), legitimate interests (security, basic service operations), consent (e.g. advertising / cookies where required), and legal obligations.',
        'You can grant or withdraw ad-related consent via the Google CMP message (“Consent”, “Do not consent”, “Manage options”) when it is shown.',
      ],
    },
    {
      title: '5. Who we share data with',
      paragraphs: [
        'Google (sign-in, Firebase Auth / Firestore / Hosting / Cloud Functions, AdSense, and Consent Mode where applicable).',
        'HERE Technologies (routing and non-Serbian tolls where applicable).',
        'PayPal (payments and subscriptions).',
        'Resend or a similar email provider (delivering bug reports to our support address), when configured.',
        'We do not sell your personal data.',
      ],
    },
    {
      title: '6. Cookies and similar technologies',
      paragraphs: [
        'We use necessary technologies for sign-in and app operation, and advertising / measurement cookies from Google AdSense where allowed by your consent or applicable rules.',
        'You can manage ad partners and choices through the Google CMP on the site and through your browser settings.',
      ],
    },
    {
      title: '7. Retention',
      paragraphs: [
        'Account and subscription data are kept while the account is active and as needed to provide the service, accounting, and legal obligations.',
        'Bug reports are kept as long as needed to handle the report.',
        'Route data is processed to produce a calculation; we do not build marketing profiles from your routes.',
      ],
    },
    {
      title: '8. International transfers',
      paragraphs: [
        'Service providers (e.g. Google, PayPal, HERE) may process data outside Serbia / the EEA. Where applicable, we rely on appropriate safeguards offered by those providers (such as standard contractual clauses).',
      ],
    },
    {
      title: '9. Your rights',
      paragraphs: [
        'Depending on applicable law, you may request access, correction, deletion, restriction, portability, or objection, and you may withdraw consent.',
        'Contact support@transportcost.info for requests. You can also sign out in the app; for full account deletion, email us.',
        'If you are in the EEA/UK, you may lodge a complaint with a data protection authority.',
      ],
    },
    {
      title: '10. Children',
      paragraphs: [
        'The service is not directed to children under 16. We do not knowingly collect children’s data.',
      ],
    },
    {
      title: '11. Changes',
      paragraphs: [
        'We may update this policy from time to time. The last updated date is shown on this page. Continued use after a change means you are aware of the updated policy, except where fresh consent is required.',
      ],
    },
  ],
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function renderSections(doc) {
  return doc.sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.title)}</h2>${section.paragraphs
          .map((p) => `<p>${escapeHtml(p)}</p>`)
          .join('')}</section>`,
    )
    .join('\n')
}

const html = `<!doctype html>
<html lang="sr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Politika privatnosti · Privacy Policy — Transport Cost</title>
  <meta name="description" content="Privacy Policy for Transport Cost (Obračun) at transportcost.info" />
  <link rel="canonical" href="https://transportcost.info/privacy" />
  <link rel="icon" type="image/png" href="/logo.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Sora:wght@700&display=swap" rel="stylesheet" />
  <style>
    :root { --ink:#0c1a2e; --muted:#5b6b7c; --accent:#0f8a5f; --brand:#0b2744; --line:#c9d5e3; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Figtree, Segoe UI, sans-serif; background: linear-gradient(180deg,#eef3f8,#e4ebf3); color:var(--ink); line-height:1.55; }
    header { position:sticky; top:0; backdrop-filter:blur(10px); background:rgba(247,249,252,.92); border-bottom:1px solid #dde6f0; padding:.75rem 1.1rem; display:flex; justify-content:space-between; gap:.75rem; align-items:center; }
    a.back { color:var(--brand); font-weight:700; text-decoration:none; font-size:.9rem; display:inline-flex; align-items:center; gap:.45rem; }
    a.back:hover { color:var(--accent); }
    a.back img { height:1.75rem; width:auto; border-radius:4px; background:#000; }
    main { width:min(46rem,100%); margin:0 auto; padding:1.25rem 1.1rem 3rem; }
    h1 { font-family:Sora,Figtree,sans-serif; font-size:1.65rem; margin:0 0 .35rem; color:var(--brand); }
    .eyebrow { margin:0; font-size:.72rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); }
    .updated { color:var(--muted); font-size:.78rem; font-weight:600; margin:0 0 1rem; }
    .intro { margin:0 0 1.25rem; color:#243447; }
    h2 { font-family:Sora,Figtree,sans-serif; font-size:1rem; margin:1.2rem 0 .4rem; color:var(--brand); }
    p { margin:0 0 .45rem; font-size:.9rem; color:#243447; }
    .lang { margin:2rem 0 1rem; padding-top:1rem; border-top:2px solid var(--line); }
    .contact { margin-top:1.5rem; padding-top:.9rem; border-top:1px solid #dde6f0; }
    .contact a { color:var(--accent); font-weight:700; }
  </style>
</head>
<body>
  <header>
    <a class="back" href="/"><img src="/logo.png" alt="" /> Transport Cost</a>
    <span style="font-size:.75rem;color:#5b6b7c;font-weight:600">transportcost.info/privacy</span>
  </header>
  <main>
    <p class="eyebrow">Pravno · Legal</p>
    <h1>Politika privatnosti</h1>
    <p class="updated">Poslednje ažuriranje: ${escapeHtml(sr.updated)}</p>
    <p class="intro">${escapeHtml(sr.intro)}</p>
    ${renderSections(sr)}
    <p class="contact"><a href="mailto:support@transportcost.info">support@transportcost.info</a></p>

    <div class="lang">
      <h1>Privacy Policy</h1>
      <p class="updated">Last updated: ${escapeHtml(en.updated)}</p>
      <p class="intro">${escapeHtml(en.intro)}</p>
      ${renderSections(en)}
      <p class="contact"><a href="mailto:support@transportcost.info">support@transportcost.info</a></p>
    </div>
  </main>
</body>
</html>
`

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'privacy')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'index.html'), html)
console.log('Wrote', join(outDir, 'index.html'))
