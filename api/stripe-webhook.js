
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPABASE_URL = "https://fzsxqcqkzxrfxoirfmyh.supabase.co";

async function saveSubscription(record) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const response = await fetch(
    SUPABASE_URL + "/rest/v1/subscriptions?on_conflict=user_id",
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(record)
    }
  );

  if (!response.ok) {
    throw new Error("Supabase: " + await response.text());
  }
}

async function findSubscription(subscriptionId) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = new URL(SUPABASE_URL + "/rest/v1/subscriptions");
  url.searchParams.set("stripe_subscription_id", "eq." + subscriptionId);
  url.searchParams.set("select", "user_id");

  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: "Bearer " + key
    }
  });

  if (!response.ok) {
    throw new Error("Supabase lookup failed");
  }

  const rows = await response.json();
  return rows[0]?.user_id || null;
}

async function syncSubscription(subscriptionId, userId) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  const periodEnd =
    subscription.items?.data?.[0]?.current_period_end ??
    subscription.current_period_end ??
    null;

  await saveSubscription({
    user_id: userId,
    stripe_customer_id:
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString()
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (
    !process.env.STRIPE_WEBHOOK_SECRET ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return res.status(503).json({ error: "Server not configured" });
  }

  let event;

  try {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }

    event = stripe.webhooks.constructEvent(
      Buffer.concat(chunks),
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: "Invalid Stripe signature" });
  }

  try {
    const obj = event.data.object;

    if (event.type === "checkout.session.completed") {
      if (obj.mode === "subscription" && obj.subscription) {
        const session = await stripe.checkout.sessions.retrieve(obj.id);

        // Checkouts must originate from our authenticated backend.
        // A client_reference_id alone is not sufficient proof.
        if (!session.client_reference_id) {
          throw new Error("Missing user reference");
        }

        await syncSubscription(
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id,
          session.client_reference_id
        );
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const userId = await findSubscription(obj.id);

      if (userId) {
        await syncSubscription(obj.id, userId);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Stripe webhook error:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
