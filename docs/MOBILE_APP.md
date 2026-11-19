# Byggvakt AI som mobilapp

## 1. Fra nettsiden (fungerer nå)
Knappen **«Last ned appen»** på byggvakt.vercel.app:
- **Android / Chrome / Edge (PC):** installerer appen med ett klikk.
- **iPhone/iPad:** viser veiledning: Safari → Del → «Legg til på Hjem-skjerm».
Kortet skjules når appen allerede er installert.

## 2. Google Play (valgfritt)
1. Opprett Google Play-utviklerkonto (engangsavgift 25 USD).
2. Gå til pwabuilder.com → skriv inn nettadressen → «Package for stores» → Android.
3. Last opp .aab-filen i Play Console. PWABuilder gir en `assetlinks.json` –
   den legges i `/.well-known/assetlinks.json` i dette repoet.

## 3. Apple App Store (valgfritt)
Krever Apple Developer-konto (99 USD/år) og en Mac med Xcode. PWABuilder kan lage iOS-pakken.
Merk: Apple krever at kjøp av digitale abonnementer inne i iOS-apper går via Apple (In-App Purchase).
