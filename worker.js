// cards — serves card pages from static assets + OpenRouter inference
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (path === "/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleChat(request, env) {
  try {
    const body = await request.json();
    const prompt = body.prompt || "";
    const contextCards = body.cards || [];

    let contextMsg = "";
    if (contextCards.length > 0) {
      contextMsg =
        "\n\nExisting cards:\n" +
        contextCards.map((c) => `Request: ${c.q}\nResponse: ${c.r}`).join("\n---\n");
    }

    const fullPrompt = prompt + contextMsg;

    const cacheKey = await hashKey(fullPrompt);
    if (env.KV) {
      const cached = await env.KV.get(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ response: cached, cached: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://ai.nspired.cc",
        "X-Title": "cards",
      },
      body: JSON.stringify({
        model: "inclusionai/ling-2.6-flash",
        messages: [
          {
            role: "system",
            content:
              "You are cards, a card-based document builder. Keep responses concise. Support actions: !action:merge! !action:clear! !action:view:grid! and theme: !theme:Name,Primary,Bg,CardBg,Text,Border!",
          },
          { role: "user", content: fullPrompt },
        ],
        max_tokens: 2000,
      }),
    });

    if (!orResponse.ok) {
      const errText = await orResponse.text();
      return new Response(
        JSON.stringify({ error: `OpenRouter error: ${orResponse.status}`, detail: errText }),
        { status: orResponse.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const orData = await orResponse.json();
    const responseText = orData.choices?.[0]?.message?.content || "(no response)";

    if (env.KV) {
      await env.KV.put(cacheKey, responseText, { expirationTtl: 3600 });
    }

    return new Response(JSON.stringify({ response: responseText, cached: false }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function hashKey(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}