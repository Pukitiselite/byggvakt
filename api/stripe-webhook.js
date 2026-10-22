const Stripe = require("stripe");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    return res.status(503).json({ error: "Stripe is not configured" });
  }

  const stripe = new Stripe(secretKey);

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks);
    const signature = req.headers["stripe-signature"];

    stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret
    );

    return res.status(503).json({
      error: "Subscription processing is not configured yet"
    });
  } catch (error) {
    return res.status(400).json({
      error: "Webhook verification failed"
    });
  }
};
