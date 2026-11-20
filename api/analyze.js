const billing = require("./_billing");
const SUPABASE_URL = "https://fzsxqcqkzxrfxoirfmyh.supabase.co";
const SUPABASE_KEY = "sb_publishable__tjgQ5uGHOd_j-l06VnlVQ_st5GWCf2";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const token = (req.headers.authorization || "")
      .match(/^Bearer (.+)$/i)?.[1];

    if (!token) {
      return res.status(401).json({
        error: "Sign-in required"
      });
    }

    // Verify the logged-in Supabase user
    const authResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!authResponse.ok) {
      return res.status(401).json({
        error: "Invalid or expired session"
      });
    }

    const user = await authResponse.json();

    if (!user.id) {
      return res.status(401).json({
        error: "Invalid user"
      });
    }

    // Verify the user's paid subscription
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceKey) {
      return res.status(503).json({
        error: "Subscription verification is not configured"
      });
    }

    // Same rule as /api/subscription-status (status, period end, test vs live mode)
    let subscription;
    try {
      subscription = await billing.getSubscriptionRow(user.id);
    } catch (err) {
      return res.status(503).json({
        error: "Could not verify subscription"
      });
    }

    if (!billing.rowGrantsAccess(subscription) && !billing.isFreeAccessUser(user)) {
      return res.status(403).json({
        error: "Active subscription required — 245 NOK/month"
      });
    }

    // Verify OpenAI configuration
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(503).json({
        error: "AI service is temporarily unavailable"
      });
    }

    const { image, context, language } = req.body || {};

    // Validate the uploaded image
    if (
      typeof image !== "string" ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) ||
      image.length > 7_500_000
    ) {
      return res.status(400).json({
        error: "Invalid image or image too large"
      });
    }

    // Reserve one AI analysis (maximum 30 per UTC day)
    const limitResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/reserve_ai_analysis`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_user_id: user.id
        })
      }
    );

    if (!limitResponse.ok) {
      console.error(
        "Daily AI limit verification failed:",
        limitResponse.status
      );

      return res.status(503).json({
        error: "Could not verify daily AI limit"
      });
    }

    const allowed = await limitResponse.json();

    if (allowed !== true) {
      return res.status(429).json({
        error: "Daily limit reached: 30 AI analyses. Try again tomorrow."
      });
    }

    const instructions = language === "en"
      ? "Analyze visible construction damage. Describe observations, possible causes, safe repair suggestions and likely materials. Explain uncertainties. Recommend a qualified professional for structural, electrical, gas, asbestos or serious moisture risks. Do not claim certainty from a photograph."
      : "Analyser synlige byggskader på norsk. Beskriv observasjoner, mulige årsaker, trygge forslag til utbedring og aktuelle materialer. Forklar usikkerhet. Anbefal fagperson ved bærende konstruksjoner, strøm, gass, asbest eller alvorlige fuktskader. Ikke trekk sikre konklusjoner fra bare et fotografi.";

    // Request AI image analysis
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          instructions,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text:
                    typeof context === "string" && context.trim()
                      ? context.slice(0, 1200)
                      : "Analyze this construction damage photo."
                },
                {
                  type: "input_image",
                  image_url: image
                }
              ]
            }
          ],
          max_output_tokens: 800
        })
      }
    );

    if (!response.ok) {
      console.error(
        "OpenAI request failed:",
        response.status
      );

      return res.status(502).json({
        error: "AI analysis is temporarily unavailable. Please try again later."
      });
    }

    const data = await response.json();

    const analysis = (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("\n");

    return res.status(200).json({
      analysis: analysis || "No analysis returned."
    });

  } catch (err) {
    console.error("Analysis error:", err);

    return res.status(500).json({
      error: "Analysis failed. Please try again later."
    });
  }
};
