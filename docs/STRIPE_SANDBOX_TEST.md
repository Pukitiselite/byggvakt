# Stripe abonements – drošs Sandbox tests (Live netiek aiztikts)

Vides mainīgo nosaukumi nemainās: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
Production vērtības **neaiztiec**. Sandbox vērtības pievieno tikai **Preview** videi.

## 1. Stripe Sandbox
1. Stripe Dashboard → konta izvēlne → **Sandboxes** → izveido/atver sandbox.
2. Product catalog → produkts "Byggvakt AI", cena **245 NOK, Recurring, Monthly** → nokopē `price_...`.
3. Developers → API keys → nokopē `sk_test_...`.

## 2. Vercel (tikai Preview)
Settings → Environment Variables → katram mainīgajam atzīmē **tikai "Preview"** (un, ja grib, tikai zaru `fix/stripe-subscriptions`):
- `STRIPE_SECRET_KEY` = `sk_test_...`
- `STRIPE_PRICE_ID` = sandbox `price_...`
- `STRIPE_WEBHOOK_SECRET` = (3. solis)
- `SUPABASE_SERVICE_ROLE_KEY` – Preview videi var izmantot to pašu vērtību, ko Production (tā pati Supabase).

Ja Preview ir ieslēgta **Deployment Protection**, Stripe to nevarēs sasniegt:
Settings → Deployment Protection → **Protection Bypass for Automation** → nokopē tokenu.

## 3. Sandbox webhook
Sandbox → Developers → Webhooks → Add endpoint:
`https://<preview-url>/api/stripe-webhook` (+ `?x-vercel-protection-bypass=<token>`, ja vajag)
Notikumi:
`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
`invoice.paid`, `invoice.payment_failed`
→ nokopē `whsec_...` → Vercel Preview `STRIPE_WEBHOOK_SECRET` → **Redeploy** Preview.

## 4. Supabase (tikai pievienošana)
SQL Editor → palaid `supabase/migrations/20261119_subscriptions_billing_columns.sql`.
Tas tikai pievieno 2 kolonnas un 2 indeksus. Kods strādā arī bez tā, bet tad nav redzama atcelšana perioda beigās un test/live nodalījums.

## 5. Tests
Izmanto **atsevišķu testa lietotāju** (jauns e-pasts), nevis īstu klientu.
1. Preview lapā pieslēdzies → "Start abonnement" → karte `4242 4242 4242 4242`, jebkurš nākotnes datums, jebkurš CVC.
2. Pārbaudi:
   - Sandbox → Webhooks → piegādes = `200`.
   - Supabase `subscriptions`: testa lietotāja rinda `status = active`, `livemode = false`.
   - Preview lapā: "✅ Abonnementet er aktivt"; AI analīze strādā.
   - Vēlreiz "Start abonnement" → "Du har allerede et abonnement." (nav otra abonementa).
   - Production lapā (byggvakt.vercel.app) tam pašam testa lietotājam piekļuves **nav** (testa rinda Live nederīga).
3. **Atcelšana perioda beigās**: Sandbox → Subscriptions → Cancel → "At period end" → lapā "Det er sagt opp…", piekļuve paliek.
4. **Atjaunošana**: tas pats abonements → "Don't cancel" → atkal "neste fornyelse".
5. **Tūlītēja atcelšana**: Cancel → "Immediately" → piekļuve pazūd; jauns "Start abonnement" atkal atļauts.
6. (Neobligāti) Neveiksmīga maksājuma karte `4000 0000 0000 0341` → `past_due` → piekļuves nav.

Vercel Logs meklē `webhook.subscription_synced` (OK) vai `webhook.user_unresolved` / `webhook.processing_failed` (problēma).

## 6. Pēc testa (tikai ar īpašnieka apstiprinājumu)
- Merge PR → Production.
- Stripe **Live** webhook `Byggvakt AI Production`: pārliecinies, ka atzīmēti tie paši 8 notikumi.
- Pēc testa var izdzēst Sandbox webhook; Supabase testa rindu var atstāt (Live to ignorē).
