-- Byggvakt AI: additive billing columns for public.subscriptions
-- ONLY adds two nullable columns. No DROP, DELETE, TRUNCATE or UPDATE. Safe to run more than once.
-- Existing schema (checked 2026-11-19): PK user_id, UNIQUE stripe_subscription_id,
-- index on stripe_customer_id, RLS enabled — so no new indexes are needed.
-- The code works without this migration (falls back to the original columns),
-- but cancel/renew status and test-vs-live separation need it.

alter table public.subscriptions add column if not exists cancel_at_period_end boolean;
alter table public.subscriptions add column if not exists livemode boolean;
