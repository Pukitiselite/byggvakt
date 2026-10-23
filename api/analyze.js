const SUPABASE_URL = "https://fzsxqcqkzxrfxoirfmyh.supabase.co";
const SUPABASE_KEY = "sb_publishable__tjgQ5uGHOd_j-l06VnlVQ_st5GWCf2";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const token = (req.headers.authorization || "").match(/^Bearer (.+)$/i)?.[1];
    if (!token) {
      return res.status(401).json({ error: "Sign-in required" });
    }

    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`
      }
    });

    if (!authResponse.ok) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    const user = await authResponse.json();
    if (!user.id) {
      return res.status(401).json({ error: "Invalid user" });
    }
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  return res.status(503).json({
    error: "Subscription verification is not configured"
  });
}

const subscriptionUrl = new URL(
  `${SUPABASE_URL}/rest/v1/subscriptions`
);

subscriptionUrl.searchParams.set("user_id", `eq.${user.id}`);
subscriptionUrl.searchParams.set(
  "select",
  "status,current_period_end"
);

const subscriptionResponse = await fetch(subscriptionUrl, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`
  }
});

if (!subscriptionResponse.ok) {
  return res.status(503).json({
    error: "Could not verify subscription"
  });
}

const subscriptions = await subscriptionResponse.json();
const subscription = subscriptions[0];

if (
  !subscription ||
  !["active", "trialing"].includes(subscription.status)
) {
  return res.status(403).json({
    error: "Active subscription required — 245 NOK/month"
  });
}
 if (
  subscription.current_period_end &&
  new Date(subscription.current_period_end).getTime() <= Date.now()
) {
  return res.status(403).json({
    error: "Subscription has expired"
  });
}   
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    }

    const { image, context, language } = req.body || {};

    if (
      typeof image !== "string" ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) ||
      image.length > 7_500_000
    ) {
      return res.status(400).json({ error: "Invalid image or image too large" });
    }

    const instructions = language === "en"
      ? "Analyze visible construction damage. Describe observations, possible causes, safe repair suggestions and likely materials. Explain uncertainties. Recommend a qualified professional for structural, electrical, gas, asbestos or serious moisture risks. Do not claim certainty from a photograph."
      : "Analyser synlige byggskader på norsk. Beskriv observasjoner, mulige årsaker, trygge forslag til utbedring og aktuelle materialer. Forklar usikkerhet. Anbefal fagperson ved bærende konstruksjoner, strøm, gass, asbest eller alvorlige fuktskader. Ikke trekk sikre konklusjoner fra bare et fotografi.";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        instructions,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: typeof context === "string" && context.trim()
                ? context.slice(0, 1200)
                : "Analyze this construction damage photo."
            },
            {
              type: "input_image",
              image_url: image
            }
          ]
        }],
        max_output_tokens: 800
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "AI service error"
      });
    }

    const analysis = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("\n");

    return res.status(200).json({
      analysis: analysis || "No analysis returned."
    });
  } catch (err) {
    return res.status(500).json({
      error: "Analysis failed: " + err.message
    });
  }
};
