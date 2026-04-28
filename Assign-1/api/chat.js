// ──────────────────────────────────────────
//  Vercel Serverless Function — Groq API Proxy
//  Keeps the API key server-side (never exposed to browser)
// ──────────────────────────────────────────

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'Server configuration error: API key not set.' });
  }

  const { systemPrompt, messages } = req.body || {};

  if (!systemPrompt || !Array.isArray(messages)) {
    return res
      .status(400)
      .json({ error: 'Invalid request: systemPrompt and messages are required.' });
  }

  // Build the message array for Groq (OpenAI-compatible format)
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: apiMessages,
        temperature: 0.8,
        max_tokens: 512,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Groq API error:', response.status, errBody);

      if (response.status === 429) {
        return res
          .status(429)
          .json({ error: 'Rate limit reached. Please wait a moment and try again.' });
      }

      return res
        .status(502)
        .json({ error: 'Failed to get a response from the AI. Please try again.' });
    }

    const data = await response.json();
    const reply =
      data.choices?.[0]?.message?.content?.trim() ||
      'I apologize, but I was unable to generate a response. Could you try rephrasing your question?';

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('API proxy error:', err);
    return res
      .status(500)
      .json({ error: 'An unexpected error occurred. Please try again later.' });
  }
}
