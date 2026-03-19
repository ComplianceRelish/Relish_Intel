// ═══════════════════════════════════════════════════════════
// Data Source Registry — all pluggable intelligence sources
// ═══════════════════════════════════════════════════════════

export const SOURCES = [
  // ── Trade Flow Data ──────────────────────────────────────
  {
    id: 'comtrade_free', name: 'UN Comtrade (Free)', cat: 'trade',
    active: true, needKey: false,
    cost: 'Free — 500 records/call',
    url: 'https://comtradeapi.un.org', docs: 'https://comtradedeveloper.un.org',
    icon: '🌐',
    desc: 'Official UN trade stats. Annual/monthly by HS code & country. Free preview: 500 records/call, unlimited calls.',
    types: ['trade_volume', 'trade_value', 'partner_country', 'unit_price'],
  },
  {
    id: 'comtrade_premium', name: 'UN Comtrade (Premium)', cat: 'trade',
    active: true, needKey: true, envKey: 'COMTRADE_API_KEY',
    cost: 'Free registration → 500 calls/day, 100K records',
    url: 'https://comtradeapi.un.org', docs: 'https://comtradedeveloper.un.org',
    icon: '🌐',
    desc: 'Full v1 API: 8 endpoints (get, getTariffline, getSUV, getMBS, getTradeMatrix, getDa). Monthly granular data, bulk downloads, bilateral comparisons. Auto-fallback to free tier.',
    types: ['monthly_data', 'tariff_line', 'bulk_download', 'bilateral', 'suv_benchmarks', 'trade_matrix', 'mbs_historical'],
  },
  {
    id: 'comtrade_tools', name: 'Comtrade Tools (Reference)', cat: 'trade',
    active: true, needKey: false,
    cost: 'Free — public reference files',
    url: 'https://comtradeapi.un.org', docs: 'https://comtradedeveloper.un.org',
    icon: '📋',
    desc: 'Reference data: reporter countries, partner areas, HS classification, flow codes, customs codes, transport modes, quantity units. Cached 24h.',
    types: ['country_codes', 'hs_classification', 'flow_codes', 'reference_data'],
  },
  {
    id: 'volza', name: 'Volza', cat: 'trade',
    active: false, needKey: true, envKey: 'VOLZA_API_KEY',
    cost: 'From $1,500/yr — per-shipment credits',
    url: 'https://www.volza.com', docs: 'https://www.volza.com/pricing/',
    icon: '📦',
    desc: '3+ billion shipment records, 203 countries. Actual buyer/supplier names, transaction prices, contact details.',
    types: ['shipment_records', 'buyer_names', 'supplier_names', 'transaction_prices', 'contact_info', 'port_data'],
  },
  {
    id: 'zauba', name: 'Zauba / Seair', cat: 'trade',
    active: false, needKey: true, envKey: 'ZAUBA_API_KEY',
    cost: 'Rs.5,000–15,000/mo',
    url: 'https://www.zauba.com', docs: 'https://www.zauba.com/shipment_search',
    icon: '🇮🇳',
    desc: 'Indian customs import/export data. Exporter names, ports, HS codes, FOB prices. Shows Indian competitors & benchmark pricing.',
    types: ['india_exports', 'india_imports', 'exporter_names', 'fob_prices', 'competitor_intel'],
  },
  {
    id: 'dgft', name: 'DGFT Trade Statistics', cat: 'trade',
    active: false, needKey: false,
    cost: 'Free — Indian govt',
    url: 'https://tradestat.commerce.gov.in', docs: 'https://tradestat.commerce.gov.in/eidb/default.asp',
    icon: '🏛️',
    desc: 'Official Indian DGFT export/import by HS code, country, port. Free but manual interface.',
    types: ['india_exports', 'india_imports', 'trade_value'],
  },
  {
    id: 'oec', name: 'OEC (Econ Complexity)', cat: 'trade',
    active: false, needKey: true, envKey: 'OEC_API_KEY',
    cost: 'Free tier + API access',
    url: 'https://oec.world', docs: 'https://oec.world/en/resources/documentation',
    icon: '🗺️',
    desc: 'Visualized global trade flows. Sankey/treemap charts. RCA index. API for programmatic access.',
    types: ['trade_flows', 'rca_index', 'complexity'],
  },
  {
    id: 'wits', name: 'World Bank WITS', cat: 'trade',
    active: false, needKey: false,
    cost: 'Free — registration required',
    url: 'https://wits.worldbank.org', docs: 'https://wits.worldbank.org/WITS/WITS/Restricted/Login.aspx',
    icon: '🏦',
    desc: 'Trade data + tariff rates + NTMs. UNCTAD TRAINS database. Great for tariff research.',
    types: ['tariff_rates', 'non_tariff_measures', 'trade_indicators'],
  },

  // ── Pricing Intelligence ─────────────────────────────────
  {
    id: 'claude_ai', name: 'Claude AI (Web Search)', cat: 'pricing',
    active: true, needKey: false,
    cost: 'Built-in — Anthropic API (server-side)',
    url: 'https://api.anthropic.com', docs: 'https://docs.anthropic.com',
    icon: '🤖',
    desc: 'AI agent with live web search. Queries Alibaba, Made-in-China, IndiaMART, trade directories. Returns structured JSON.',
    types: ['live_pricing', 'buyer_intel', 'grade_specs', 'market_research'],
  },
  {
    id: 'chemanalyst', name: 'ChemAnalyst', cat: 'pricing',
    active: false, needKey: true, envKey: 'CHEMANALYST_API_KEY',
    cost: 'Free basic + Premium',
    url: 'https://www.chemanalyst.com', docs: 'https://www.chemanalyst.com/Pricing/Pricingoverview',
    icon: '📊',
    desc: 'Weekly price tracking for 1000+ chemicals. CaCO3, H3PO4, CaO in India. Price forecasts, demand-supply.',
    types: ['weekly_prices', 'price_forecast', 'demand_supply', 'plant_shutdowns'],
  },
  {
    id: 'echemi', name: 'ECHEMI', cat: 'pricing',
    active: false, needKey: true, envKey: 'ECHEMI_API_KEY',
    cost: 'Free sample + subscription',
    url: 'https://www.echemi.com', docs: 'https://www.echemi.com/price-database.html',
    icon: '🇨🇳',
    desc: 'Chinese chemical commodity prices updated DAILY. 200+ chemicals, 16 categories. Critical for China-side pricing.',
    types: ['china_daily_prices', 'price_history', 'price_comparison'],
  },
  {
    id: 'intratec', name: 'Intratec', cat: 'pricing',
    active: false, needKey: false,
    cost: 'Free — ~1yr lag',
    url: 'https://www.intratec.us', docs: 'https://www.intratec.us/chemical-markets',
    icon: '📈',
    desc: 'Chemical pricing for 200+ chemicals with ~1 year lag. Good for historical benchmarking & production cost.',
    types: ['historical_prices', 'production_costs'],
  },

  // ── Marketplaces ─────────────────────────────────────────
  {
    id: 'alibaba', name: 'Alibaba / 1688.com', cat: 'marketplace',
    active: false, needKey: true, envKey: 'ALIBABA_API_KEY',
    cost: 'API via Alibaba Open Platform',
    url: 'https://www.alibaba.com', docs: 'https://open.alibaba.com',
    icon: '🏪',
    desc: 'Live supplier pricing, MOQ, shipping terms. 1688.com for China domestic. RFQ system.',
    types: ['supplier_prices', 'moq', 'rfq', 'product_specs'],
  },
  {
    id: 'indiamart', name: 'IndiaMART', cat: 'marketplace',
    active: false, needKey: true, envKey: 'INDIAMART_API_KEY',
    cost: 'API via IndiaMESH',
    url: 'https://www.indiamart.com', docs: 'https://seller.indiamart.com',
    icon: '🛒',
    desc: 'India\'s largest B2B marketplace. Input cost tracking for CalciWorks.',
    types: ['india_supplier_prices', 'input_costs', 'supplier_directory'],
  },

  // ── Regulatory ───────────────────────────────────────────
  {
    id: 'gacc', name: 'GACC / CIFER', cat: 'regulatory',
    active: false, needKey: false,
    cost: 'Free — China customs DB',
    url: 'https://cifer.singlewindow.cn', docs: 'https://english.customs.gov.cn',
    icon: '🏛️',
    desc: 'China GACC overseas manufacturer registration database. Check registration status for market access.',
    types: ['gacc_registration', 'registered_exporters'],
  },
  {
    id: 'mpeda', name: 'MPEDA / EIC India', cat: 'regulatory',
    active: false, needKey: false,
    cost: 'Free — Indian seafood authority',
    url: 'https://mpeda.gov.in', docs: 'https://eicindia.gov.in',
    icon: '🐟',
    desc: 'Marine Products Export Development Authority. Approved units list, export stats by species.',
    types: ['approved_units', 'species_stats', 'eic_approvals'],
  },
];

// Category metadata
export const SOURCE_CATEGORIES = {
  trade: { label: 'Trade Flow Data', icon: '📊' },
  pricing: { label: 'Pricing Intelligence', icon: '💰' },
  marketplace: { label: 'Marketplaces', icon: '🏪' },
  regulatory: { label: 'Regulatory', icon: '🏛️' },
};
