# Byggvakt AI – Google Play publicēšana (soli pa solim)

Pakotnes nosaukums (package ID): **`com.byggvaktai.app`** – to vēlāk mainīt nevar.

## A. Android faila izveide (pwabuilder.com)
1. Atver https://www.pwabuilder.com → ieraksti `https://byggvaktai.com` → **Start**.
2. **Package For Stores** → **Android** → **Generate Package** → **Options** (vai "All settings"):
   - **Package ID:** `com.byggvaktai.app`
   - **App name:** `Byggvakt AI` · **Short name:** `Byggvakt`
   - **Host:** `byggvaktai.com`
   - **Start URL / Launch URL:** `/?source=twa`  ← svarīgi: tā lietotne paslēpj cenas un maksājumu pogas
   - **Theme / status bar color:** `#103c33` · **Background:** `#f3f7f4`
   - **Signing key:** *Create new*. Aizpildi vārdu, uzņēmumu (Byggvakt AI), valsti NO, un **paroles saglabā drošā vietā**.
3. **Download** → zip. Tajā ir: `.aab` (augšupielādei), `.apk` (testēšanai telefonā), `signing.keystore` + `signing-key-info.txt` (**glabā drošībā – bez tā nevarēsi atjaunināt lietotni!**) un `assetlinks.json`.
4. Atsūti Claude **`assetlinks.json` saturu** (tajā nav noslēpumu – tikai publisks pirkstu nospiedums). Claude to publicēs `https://byggvaktai.com/.well-known/assetlinks.json`.

## B. Play Console – lietotnes izveide
**Create app** → App name `Byggvakt AI` · Default language **Norwegian (Bokmål) – no-NO** · App · Free · apstiprini deklarācijas.

## C. Veikala ieraksts (Main store listing)
**App name (≤30):** `Byggvakt AI`

**Short description (≤80):**
`Oversikt over byggeprosjekter med bilder, notater og AI-analyse av skader.`

**Full description:**
```
Byggvakt AI gir deg enkel oversikt over byggeprosjektene dine – hjemme, på hytta eller på jobb.

• Prosjektoversikt: status (planlagt, pågår, ferdig), fremdrift i prosent, adresse og notater
• Bilder: last opp bilder til hvert prosjekt, lagret trygt i skyen
• AI-bildeanalyse: ta bilde av en skade og få forslag til mulige årsaker, utbedring og materialer
• Synkronisering: logg inn og se prosjektene på alle enhetene dine
• Sikkerhetskopi: eksporter prosjektene dine når du vil

AI-analysen er veiledende og kan ta feil. Ved bærende konstruksjoner, strøm, gass, asbest eller alvorlig fukt bør du alltid kontakte en fagperson.

AI-bildeanalyse krever et aktivt abonnement på kontoen.

Personvern: https://byggvaktai.com/personvern.html
```
**Grafika:** `store/app-icon-512.png` (ikona), `store/feature-graphic-1024x500.png` (feature graphic), **2–8 telefona ekrānuzņēmumi** (tu tos uzņem telefonā lietotnē: sākums, projekts, AI analīze).
**Category:** House & Home (vai Productivity) · **Email:** pukitiselite@gmail.com · **Website:** https://byggvaktai.com

## D. App content (Policy → App content)
- **Privacy policy:** `https://byggvaktai.com/personvern.html`
- **App access:** "All or some functionality is restricted" → izveido **testa kontu Google pārbaudītājiem** (e-pasts + parole) ar aktīvu abonementu, un apraksti: "Log in with the test account to access projects and AI image analysis."
- **Ads:** No ads
- **Content rating:** aizpildi anketu (nav vardarbības u.c.) → Everyone/3+
- **Target audience:** 18+
- **News app:** No · **Government app:** No · **Financial features:** No · **Health:** No
- **Data safety** (atbildes):
  - Collects data: **Yes** · Encrypted in transit: **Yes** · Users can request deletion: **Yes** → URL `https://byggvaktai.com/slett-konto.html`
  - **Personal info → Email address:** Collected, required, *App functionality, Account management*
  - **Photos and videos → Photos:** Collected, optional (lietotājs pats augšupielādē), *App functionality*. Shared: **No** – OpenAI, Supabase u.c. apstrādā datus mūsu vārdā kā pakalpojumu sniedzēji (Google to neuzskata par "sharing").
  - **App activity → Other user-generated content** (projekti, piezīmes): Collected, *App functionality*
  - **Financial info → Purchase history:** Collected (abonementa statuss), *App functionality*
  - Nav: atrašanās vieta, kontakti, reklāmas ID, analītika.
- **Account deletion URL:** `https://byggvaktai.com/slett-konto.html`

## E. Slēgtais tests (obligāts personīgajam kontam)
1. **Testing → Closed testing → Create track** → **Testers:** e-pasta saraksts ar **vismaz 12 (labāk 15–20) cilvēkiem** ar Google kontiem.
2. **Create release** → augšupielādē `.aab` → Release notes: "Første testversjon." → **Review and roll out**.
3. Pēc Google apstiprinājuma nosūti testētājiem **opt-in saiti**; viņiem jāpievienojas un jāinstalē lietotne, un jāpaliek pievienotiem **14 dienas pēc kārtas**.
4. Pēc 14 dienām: **Apply for production access** → atbildi uz jautājumiem → pēc apstiprināšanas Production release.

## F. Pēc pirmās augšupielādes
Play Console → **Test and release → App integrity → App signing** → nokopē **SHA-256 no "App signing key certificate"** un atsūti Claude. Tas jāpievieno `assetlinks.json`, citādi no Play instalētajai lietotnei augšā redzama pārlūka adreses josla.

## Maksājumi Play versijā
Lietotne, kas atvērta ar `/?source=twa`, **nerāda cenas, "Start abonnement", "Administrer abonnement" un "Last ned appen"**. Abonementu var iegādāties tikai mājaslapā byggvaktai.com. Konta dzēšana lietotnē paliek pieejama (Google prasība).
