// ═══════════════════════════════════════════════════════════
// HS Code Configuration — CalciWorks + ClamFlow products
// ═══════════════════════════════════════════════════════════

export const HS_CODES = {
  '283650': { name: 'Calcium Carbonate (CaCO3/GCC)', shortName: 'CaCO3', color: '#2563eb', cat: 'chem' },
  '283526': { name: 'Calcium Phosphates (incl. HAp)', shortName: 'Ca-Phosphates', color: '#7c3aed', cat: 'chem' },
  '282510': { name: 'Calcium Oxide (CaO/Quicklime)', shortName: 'CaO', color: '#dc2626', cat: 'chem' },
  '291811': { name: 'Lactic Acid & Salts (Ca-Lactate)', shortName: 'Ca-Lactate', color: '#059669', cat: 'chem' },
  '030771': { name: 'Clams, Live/Fresh/Chilled', shortName: 'Clams-Live', color: '#0891b2', cat: 'sea' },
  '030772': { name: 'Clams, Frozen (in/out shell)', shortName: 'Clams-Frozen', color: '#0e7490', cat: 'sea' },
  '030779': { name: 'Clams, Dried/Salted/Smoked', shortName: 'Clams-Dried', color: '#155e75', cat: 'sea' },
  '030791': { name: 'Molluscs n.e.s., Live/Fresh', shortName: 'Molluscs', color: '#164e63', cat: 'sea' },
  '160556': { name: 'Clams, Prepared/Preserved', shortName: 'Clams-Prep', color: '#6366f1', cat: 'sea' },
};

// Convenience: array of HS code keys
export const HS_CODE_LIST = Object.keys(HS_CODES);

// Codes included in time-series trend analysis
export const TREND_CODES = ['283650', '283526', '030772', '030779', '160556'];
