
const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPABASE_URL = "https://fzsxqcqkzxrfxoirfmyh.supabase.co";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY) {
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

  // Subscription processing will be added next.
  // Do not acknowledge events until processing is implemented.
  return res.status(503).json({
    error: "Subscription processing not configured"
  });
};
