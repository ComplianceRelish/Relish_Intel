// ═══════════════════════════════════════════════════════════
// HS Code Configuration — CalciWorks + ClamFlow products
// ═══════════════════════════════════════════════════════════

export const HS_CODES = {
  '283650': {
    name: 'Calcium Carbonate (CaCO3/GCC)',
    shortName: 'CaCO3',
    color: '#2563eb',
    cat: 'chem',
    note: 'Covers all grades: filler, paper coating, food, pharma. Bulk trade is industrial filler grade.',
  },
  '283526': {
    name: 'Calcium Phosphates (DCP/TCP/HAp)',
    shortName: 'Ca-Phosphates',
    color: '#7c3aed',
    cat: 'chem',
    note: 'Bulk of trade is cheap DCP/TCP (animal feed, $500–900/MT). HAp (medical/nano) is $50–500/kg but a tiny fraction of volume.',
    // Price-split: separate high-value (HAp) from bulk (DCP/TCP) shipments
    split: {
      thresholdPerKg: 3, // $/kg cutoff — above = HAp/specialty, below = bulk DCP
      highLabel: 'HAp / Specialty Ca-Phosphates',
      highShortName: 'HAp (est.)',
      highColor: '#a855f7',
      highNote: 'Estimated HAp/specialty: shipments where declared value > $3/kg ($3,000/MT). Includes food-grade TCP, pharma HAp, nano-HAp.',
      lowLabel: 'Bulk DCP/TCP (Animal Feed)',
      lowShortName: 'Bulk DCP',
      lowColor: '#6d28d9',
      lowNote: 'Bulk calcium phosphates: DCP/MCP for animal feed, fertilizer-grade TCP. Declared value ≤ $3/kg.',
    },
  },
  '282510': {
    name: 'Calcium Oxide (CaO/Quicklime)',
    shortName: 'CaO',
    color: '#dc2626',
    cat: 'chem',
    note: 'Industrial quicklime. Bulk commodity, low value per MT.',
  },
  '291811': {
    name: 'Lactic Acid & Salts (Ca-Lactate)',
    shortName: 'Ca-Lactate',
    color: '#059669',
    cat: 'chem',
    note: 'Includes lactic acid + all metal lactates. Ca-Lactate is a subset.',
  },
  '030771': {
    name: 'Clams, Live/Fresh/Chilled',
    shortName: 'Clams-Live',
    color: '#0891b2',
    cat: 'sea',
    note: 'Fresh clams in shell or shucked. Higher price per kg than frozen.',
  },
  '030772': {
    name: 'Clams, Frozen (in/out shell)',
    shortName: 'Clams-Frozen',
    color: '#0e7490',
    cat: 'sea',
    note: 'Largest clam trade category by volume. IQF, block frozen, shell-on/shucked.',
  },
  '030779': {
    name: 'Clams, Dried/Salted/Smoked',
    shortName: 'Clams-Dried',
    color: '#155e75',
    cat: 'sea',
    note: 'Premium pricing due to processing. Sun-dried, smoked, salted.',
  },
  '030791': {
    name: 'Molluscs n.e.s., Live/Fresh',
    shortName: 'Molluscs',
    color: '#164e63',
    cat: 'sea',
    note: 'Catch-all for molluscs not elsewhere specified. May include octopus, cuttlefish, etc.',
  },
  '160556': {
    name: 'Clams, Prepared/Preserved',
    shortName: 'Clams-Prep',
    color: '#6366f1',
    cat: 'sea',
    note: 'Value-added: canned, retorted, ready-to-eat clam products.',
  },
};

// Convenience: array of HS code keys
export const HS_CODE_LIST = Object.keys(HS_CODES);

// Codes included in time-series trend analysis
export const TREND_CODES = ['283650', '283526', '030772', '030779', '160556'];
