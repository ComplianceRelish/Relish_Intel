// ═══════════════════════════════════════════════════════════
// GET /api/health — Server status + configured data sources
// ═══════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Check which source keys are configured (don't expose the actual keys!)
  const sources = {
    comtrade_free:    { configured: true, active: true },
    comtrade_premium: { configured: !!process.env.COMTRADE_API_KEY, active: !!process.env.COMTRADE_API_KEY },
    comtrade_tools:   { configured: true, active: true },  // reference data — no key needed
    claude_ai:        { configured: !!process.env.ANTHROPIC_API_KEY, active: true },
    volza:            { configured: !!process.env.VOLZA_API_KEY },
    zauba:            { configured: !!process.env.ZAUBA_API_KEY },
    chemanalyst:      { configured: !!process.env.CHEMANALYST_API_KEY },
    echemi:           { configured: !!process.env.ECHEMI_API_KEY },
    oec:              { configured: !!process.env.OEC_API_KEY },
    alibaba:          { configured: !!process.env.ALIBABA_API_KEY },
    indiamart:        { configured: !!process.env.INDIAMART_API_KEY },
    dgft:             { configured: true, active: false }, // free, no key
    wits:             { configured: true, active: false },
    intratec:         { configured: true, active: false },
    gacc:             { configured: true, active: false },
    mpeda:            { configured: true, active: false },
  };

  const configuredSources = Object.entries(sources)
    .filter(([, v]) => v.configured || v.active)
    .map(([k]) => k);

  return res.status(200).json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    sources,
    configuredSources,
    supabase: !!process.env.VITE_SUPABASE_URL,
  });
}
