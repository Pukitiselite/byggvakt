module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    }

    const { image, context, language } = req.body || {};

    if (
      typeof image !== "string" ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image) ||
      image.length > 7_500_000
    ) {
      return res.status(400).json({ error: "Invalid image or image too large" });
    }

    const prompt = language === "en"
      ? "Analyze the visible construction damage. Describe observations, possible causes, safe repair suggestions, and likely materials. Clearly state uncertainties. Advise consulting a professional for structural, electrical, gas, asbestos, or serious moisture risks."
      : "Analyser synlige byggskader. Beskriv observasjoner, mulige årsaker, trygge forslag til utbedring og aktuelle materialer. Forklar usikkerhet. Anbefal fagperson ved bærende konstruksjoner, strøm, gass, asbest eller alvorlige fuktskader.";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        instructions: prompt,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: typeof context === "string"
                ? context.slice(0, 1200)
                : "Analyze this image."
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
