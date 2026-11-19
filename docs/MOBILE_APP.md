# Byggvakt AI som mobilapp (PWA)

Nettsiden kan installeres som app – ingen App Store / Google Play nødvendig.

**iPhone (Safari):** åpne byggvakt.vercel.app → Del-knappen → «Legg til på Hjem-skjerm».
**Android (Chrome):** åpne byggvakt.vercel.app → meny ⋮ → «Installer app» / «Legg til på startskjermen».

Appen åpnes i fullskjerm med eget ikon. Service workeren (`sw.js`) lagrer bare selve siden og ikonene,
aldri API-svar, betaling (Stripe) eller Supabase-data. Siden hentes alltid fra nettet først, så nye versjoner vises med en gang.
