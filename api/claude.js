// ═══════════════════════════════════════════════════════════
// POST /api/claude — Proxy to Anthropic Claude API
// Keeps ANTHROPIC_API_KEY server-side, never exposed to browser
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { prompt, systemPrompt } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: 'Missing required field: prompt' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY not configured. Add it to your .env file.',
    });
  }

  try {
    // Build the request body
    const requestBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system:
        systemPrompt ||
        'You are a trade data research assistant for Relish Group (India). Provide accurate, current market data with sources and dates. Return ONLY valid JSON. No markdown, no backticks, no preamble.',
      messages: [{ role: 'user', content: prompt }],
    };

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };

    // First attempt: with web search tool
    let response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...requestBody,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      }),
    });

    // If 400 with tools, retry without tools (tool spec might be incompatible)
    if (response.status === 400) {
      const errText = await response.text();
      console.warn(`Claude 400 with web_search tool, retrying without tools. Error: ${errText.slice(0, 300)}`);
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });
    }

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`Claude API error ${response.status}:`, errBody);
      if (response.status === 401) {
        return res.status(401).json({
          error: 'Claude API authentication failed (401). Check that ANTHROPIC_API_KEY is valid and has credits.',
          details: errBody,
        });
      }
      return res.status(response.status).json({
        error: `Claude API returned ${response.status}`,
        details: errBody,
      });
    }

    const data = await response.json();
    const text = data.content?.map((b) => b.text || '').filter(Boolean).join('\n') || '';

    // Try to parse as JSON
    let parsed = null;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      // Not valid JSON — return as raw text
    }

    return res.status(200).json({ content: text, parsed });
  } catch (err) {
    console.error('Claude proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
