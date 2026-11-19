-- Byggvakt AI: additive billing columns for public.subscriptions
-- ONLY adds columns/indexes. No DROP, DELETE, TRUNCATE or UPDATE. Safe to run more than once.
-- The code works without this migration (it falls back to the original columns),
-- but cancel/renew status and test-vs-live separation need it.

alter table public.subscriptions add column if not exists cancel_at_period_end boolean;
alter table public.subscriptions add column if not exists livemode boolean;

create index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id);
create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);

-- Check (read-only): the webhook upserts with on_conflict=user_id, so user_id must be unique.
-- select indexname, indexdef from pg_indexes where tablename = 'subscriptions';
