// ═══════════════════════════════════════════════════════════
// Formatting Helpers
// ═══════════════════════════════════════════════════════════

/** Format as USD with commas, no decimals */
export const fmtUSD = (n) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** Format as USD with 2 decimals (unit pricing) */
export const fmtPrice = (n) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format kilograms as Metric Tonnes (Indian locale) */
export const fmtMT = (kg) =>
  kg == null ? '—' : (kg / 1000).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' MT';

/** Format number with Indian locale commas */
export const fmtNum = (n) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** Try to parse JSON from a potentially messy Claude response */
export const parseJSON = (raw) => {
  if (!raw) return null;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  // 1. Direct parse
  try { return JSON.parse(cleaned); } catch { /* next */ }
  // 2. Extract first JSON array from mixed text
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) try { return JSON.parse(arrMatch[0]); } catch { /* next */ }
  // 3. Extract first JSON object from mixed text
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) try { return JSON.parse(objMatch[0]); } catch { /* ignore */ }
  return null;
};

/** Shorten large USD values to $X.XM / $X.XK */
export const fmtUSDShort = (n) => {
  if (n == null) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
};
