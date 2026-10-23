const Stripe = require("stripe");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPABASE_URL = "https://fzsxqcqkzxrfxoirfmyh.supabase.co";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: "Stripe not configured" });
  }

  try {
    const token = (req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "");

    if (!token) {
      return res.status(401).json({ error: "Logg inn først." });
    }

    const authResponse = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY ||
          "sb_publishable__tjgQ5uGHOd_j-l06VnlVQ_st5GWCf2",
        Authorization: "Bearer " + token
      }
    });

    if (!authResponse.ok) {
      return res.status(401).json({ error: "Ugyldig innlogging." });
    }

    const user = await authResponse.json();

    if (!user.id) {
      return res.status(401).json({ error: "Ugyldig bruker." });
    }

    // Stripe price ID will be configured in Vercel.
    const priceId = process.env.STRIPE_PRICE_ID;

    if (!priceId) {
      return res.status(503).json({ error: "Stripe price not configured" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email,
      success_url: "https://byggvakt.vercel.app/?payment=success",
      cancel_url: "https://byggvakt.vercel.app/?payment=cancelled"
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({
      error: "Kunne ikke starte betaling."
    });
  }
};
