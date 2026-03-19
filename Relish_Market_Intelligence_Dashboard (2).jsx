import { useState, useCallback, useRef, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════
// RELISH MARKET INTELLIGENCE DASHBOARD
// Real-time data collection from free/API sources for CalciWorks
// Sources: UN Comtrade (free preview), Claude AI web research
// ═══════════════════════════════════════════════════════════════════

// ── HS Code Configuration ──────────────────────────────────────────
const HS_CODES = {
  "283650": { name: "Calcium Carbonate (CaCO3/GCC)", shortName: "CaCO3", color: "#2563eb" },
  "283526": { name: "Calcium Phosphates (incl. HAp)", shortName: "Ca-Phosphates", color: "#7c3aed" },
  "282510": { name: "Calcium Oxide (CaO/Quicklime)", shortName: "CaO", color: "#dc2626" },
  "291811": { name: "Lactic Acid & Salts (Ca-Lactate)", shortName: "Ca-Lactate", color: "#059669" },
  "030771": { name: "Clams, Live/Fresh/Chilled", shortName: "Clams-Live", color: "#0891b2" },
  "030772": { name: "Clams, Frozen (in/out shell)", shortName: "Clams-Frozen", color: "#0e7490" },
  "030779": { name: "Clams, Dried/Salted/Smoked/Brine", shortName: "Clams-Dried", color: "#155e75" },
  "030791": { name: "Molluscs n.e.s., Live/Fresh/Chilled", shortName: "Molluscs-Fresh", color: "#164e63" },
  "160556": { name: "Clams, Prepared/Preserved", shortName: "Clams-Prep", color: "#6366f1" },
};

const CLAM_SPECIES = [
  { scientific: "Villorita cyprinoides", common: "Indian Black Clam / Karimeen Kakka", region: "Kerala backwaters", notes: "Primary RHHF species. Brackish water, V. cyprinoides." },
  { scientific: "Corbicula fluminea", common: "Asian/Golden Corbicula Clam", region: "China, SE Asia rivers", notes: "Freshwater clam. Major Chinese consumption species." },
  { scientific: "Meretrix meretrix", common: "Yellow Clam / Asiatic Hard Clam", region: "Indo-Pacific coast", notes: "Marine. High value dried clam meat market in China." },
];

const COUNTRY_CODES = {
  "156": "China", "699": "India", "704": "Vietnam", "392": "Japan",
  "410": "South Korea", "764": "Thailand", "360": "Indonesia", "458": "Malaysia",
  "276": "Germany", "840": "USA", "826": "UK", "036": "Australia",
  "0": "World",
};

// ── UN Comtrade Free Preview API ───────────────────────────────────
const COMTRADE_BASE = "https://comtradeapi.un.org/public/v1/preview/C";

async function fetchComtrade(freq, reporterCode, cmdCode, flowCode, partnerCode = null, period = "2023") {
  const params = new URLSearchParams({
    reportercode: reporterCode,
    flowCode,
    period,
    cmdCode,
    maxRecords: "500",
    format: "JSON",
    breakdownMode: "classic",
    includeDesc: "True",
  });
  if (partnerCode) params.set("partnerCode", partnerCode);
  const url = `${COMTRADE_BASE}/${freq}/HS?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Comtrade ${resp.status}: ${resp.statusText}`);
  const json = await resp.json();
  return json.data || [];
}

// ── Claude AI Research Agent ───────────────────────────────────────
async function askClaude(prompt, systemPrompt = "") {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt || "You are a trade data research assistant. Return ONLY valid JSON. No markdown, no backticks, no explanation.",
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  const data = await resp.json();
  return data.content?.map(b => b.text || "").filter(Boolean).join("\n") || "";
}

// ── Formatting helpers ─────────────────────────────────────────────
const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtUSD = (n) => n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPrice = (n) => n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMT = (kg) => kg == null ? "—" : (kg / 1000).toLocaleString("en-IN", { maximumFractionDigits: 0 }) + " MT";

// ── Main App ───────────────────────────────────────────────────────
export default function RelishMarketIntel() {
  const [activeTab, setActiveTab] = useState("trade");
  const [tradeData, setTradeData] = useState(null);
  const [priceData, setPriceData] = useState(null);
  const [buyerData, setBuyerData] = useState(null);
  const [specData, setSpecData] = useState(null);
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [logs, setLogs] = useState([]);
  const logRef = useRef(null);

  const addLog = useCallback((msg, type = "info") => {
    const ts = new Date().toLocaleTimeString("en-IN", { hour12: false });
    setLogs(prev => [...prev.slice(-100), { ts, msg, type }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // ── TRADE FLOW FETCHER ───────────────────────────────────────────
  const fetchTradeFlows = useCallback(async () => {
    setLoading(p => ({ ...p, trade: true }));
    setErrors(p => ({ ...p, trade: null }));
    addLog("Starting UN Comtrade data pull...", "info");

    const results = { chinaImports: {}, indiaExports: {}, timeSeries: {} };
    const years = ["2020", "2021", "2022", "2023"];
    const codes = Object.keys(HS_CODES);

    for (const code of codes) {
      const hs = HS_CODES[code];
      addLog(`Fetching China imports of ${hs.shortName} (HS ${code})...`);
      try {
        // China imports from all partners, latest year
        const data = await fetchComtrade("A", "156", code, "M", null, "2023");
        results.chinaImports[code] = data
          .filter(r => r.partnerCode !== 0 && r.primaryValue > 0)
          .sort((a, b) => (b.primaryValue || 0) - (a.primaryValue || 0))
          .slice(0, 15)
          .map(r => ({
            partner: r.partnerDesc || COUNTRY_CODES[String(r.partnerCode)] || r.partnerCode,
            partnerCode: r.partnerCode,
            value: r.primaryValue,
            netWeight: r.netWgt,
            qty: r.qty,
            qtyUnit: r.qtyUnitAbbr || r.qtyUnitCode,
            unitPrice: r.netWgt > 0 ? r.primaryValue / (r.netWgt / 1000) : null,
          }));
        addLog(`  → ${results.chinaImports[code].length} partners found`, "success");
        await new Promise(r => setTimeout(r, 1200)); // rate limit

        // India exports to all partners
        addLog(`Fetching India exports of ${hs.shortName}...`);
        const indiaData = await fetchComtrade("A", "699", code, "X", null, "2023");
        results.indiaExports[code] = indiaData
          .filter(r => r.partnerCode !== 0 && r.primaryValue > 0)
          .sort((a, b) => (b.primaryValue || 0) - (a.primaryValue || 0))
          .slice(0, 15)
          .map(r => ({
            partner: r.partnerDesc || COUNTRY_CODES[String(r.partnerCode)] || r.partnerCode,
            value: r.primaryValue,
            netWeight: r.netWgt,
            unitPrice: r.netWgt > 0 ? r.primaryValue / (r.netWgt / 1000) : null,
          }));
        addLog(`  → ${results.indiaExports[code].length} destinations found`, "success");
        await new Promise(r => setTimeout(r, 1200));

        // Time series for key codes (chemicals + clams)
        if (["283650", "283526", "030772", "030779", "160556"].includes(code)) {
          results.timeSeries[code] = {};
          for (const yr of years) {
            addLog(`  Time series: China imports ${hs.shortName} ${yr}...`);
            try {
              const tsData = await fetchComtrade("A", "156", code, "M", "0", yr);
              const row = tsData[0];
              results.timeSeries[code][yr] = {
                value: row?.primaryValue || 0,
                netWeight: row?.netWgt || 0,
              };
            } catch { results.timeSeries[code][yr] = { value: 0, netWeight: 0 }; }
            await new Promise(r => setTimeout(r, 1200));
          }
        }
      } catch (err) {
        addLog(`  ✗ Error: ${err.message}`, "error");
        results.chinaImports[code] = [];
        results.indiaExports[code] = [];
      }
    }

    setTradeData(results);
    setLoading(p => ({ ...p, trade: false }));
    addLog("Trade flow data collection complete!", "success");
  }, [addLog]);

  // ── PRICE RESEARCH (Claude AI) ──────────────────────────────────
  const fetchPricing = useCallback(async () => {
    setLoading(p => ({ ...p, price: true }));
    setErrors(p => ({ ...p, price: null }));
    addLog("Starting Claude AI price research...", "info");

    const products = [
      { name: "Hydroxyapatite powder", grades: "industrial (>95%), food/cosmetic (>98%), medical (>99.5%), nano-HAp (<100nm)" },
      { name: "Ground Calcium Carbonate (GCC)", grades: "filler grade, food grade, coated, uncoated" },
      { name: "Calcium Oxide (Quicklime)", grades: "industrial, food grade" },
      { name: "Calcium Lactate", grades: "food grade, pharmaceutical grade" },
      { name: "Phosphoric Acid 85%", grades: "technical, food grade (input cost)" },
      { name: "Frozen Clam Meat (Villorita cyprinoides / Corbicula / Yellow Clam)", grades: "IQF shell-on, IQF shucked meat, block frozen meat, blanched meat" },
      { name: "Dried Clam Meat", grades: "sun-dried whole, oven-dried, smoked, salted-dried" },
      { name: "Clam Meat (fresh/chilled)", grades: "fresh shucked, vacuum packed, MAP packed" },
    ];

    const results = [];
    for (const prod of products) {
      addLog(`Researching current pricing: ${prod.name}...`);
      try {
        const prompt = `Search for current 2025-2026 bulk pricing for ${prod.name} across these grades: ${prod.grades}.

Find prices from Alibaba, Made-in-China, IndiaMART, and industry reports. Return ONLY a JSON array like:
[{"grade":"industrial","priceMin":5,"priceMax":25,"unit":"USD/kg","source":"Alibaba","moq":"1 MT","notes":"FOB China"}]

Include all grades you find. Focus on bulk/wholesale, not retail.`;
        const raw = await askClaude(prompt);
        try {
          const cleaned = raw.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          results.push({ product: prod.name, grades: parsed });
          addLog(`  → ${parsed.length} price points found`, "success");
        } catch {
          results.push({ product: prod.name, grades: [], rawResponse: raw });
          addLog(`  → Got response, parsing as text`, "warn");
        }
      } catch (err) {
        addLog(`  ✗ Error: ${err.message}`, "error");
        results.push({ product: prod.name, grades: [], error: err.message });
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    setPriceData(results);
    setLoading(p => ({ ...p, price: false }));
    addLog("Price research complete!", "success");
  }, [addLog]);

  // ── BUYER IDENTIFICATION (Claude AI) ────────────────────────────
  const fetchBuyers = useCallback(async () => {
    setLoading(p => ({ ...p, buyer: true }));
    addLog("Starting buyer identification research...", "info");

    const segments = [
      { segment: "China HAp/Calcium Phosphate buyers", query: "Find major Chinese companies that import or use hydroxyapatite powder or calcium phosphate for oral care, cosmetics, medical devices, or supplements. Search Alibaba buying requests, industry directories. Return JSON array: [{\"company\":\"...\",\"city\":\"...\",\"segment\":\"oral care/medical/supplements\",\"estimatedVolume\":\"...\",\"source\":\"...\",\"contactHint\":\"...\"}]" },
      { segment: "China CaCO3 industrial buyers", query: "Find major Chinese companies that import calcium carbonate (GCC) for plastics, paper, paint, rubber, or construction. Focus on large importers in Guangdong, Zhejiang, Shandong. Return JSON array: [{\"company\":\"...\",\"city\":\"...\",\"segment\":\"plastics/paper/paint\",\"estimatedVolume\":\"...\",\"source\":\"...\",\"contactHint\":\"...\"}]" },
      { segment: "India domestic CaCO3/HAp buyers", query: "Find major Indian companies that buy ground calcium carbonate or hydroxyapatite for plastics, paints, toothpaste, supplements. Focus on companies in Gujarat, Maharashtra, Tamil Nadu. Return JSON array: [{\"company\":\"...\",\"city\":\"...\",\"segment\":\"...\",\"estimatedVolume\":\"...\",\"source\":\"...\",\"contactHint\":\"...\"}]" },
      { segment: "China clam/shellfish importers", query: "Find Chinese companies that import clams, shellfish, or bivalve molluscs. Search for importers in Dalian, Qingdao, Guangzhou, Shanghai seafood markets. Return JSON array: [{\"company\":\"...\",\"city\":\"...\",\"segment\":\"seafood import/wholesale/processing\",\"estimatedVolume\":\"...\",\"source\":\"...\",\"contactHint\":\"...\"}]" },
      { segment: "China frozen clam meat importers", query: "Find Chinese companies that specifically import frozen clam meat, frozen Corbicula, frozen yellow clam (Meretrix), or frozen bivalve meat for hotpot restaurants, food processing, or wholesale distribution. Focus on Dalian, Qingdao, Guangzhou Huangsha market, Fujian. Also search 1688.com and Alibaba for frozen clam buying requests from China. Return JSON array: [{\"company\":\"...\",\"city\":\"...\",\"segment\":\"frozen seafood import/hotpot supply/food processing\",\"estimatedVolume\":\"...\",\"source\":\"...\",\"contactHint\":\"...\"}]" },
      { segment: "China dried clam/shellfish buyers", query: "Find Chinese companies or markets that import or trade dried clam meat, dried shellfish, or dried seafood products. Dried clam is a premium product in Chinese cuisine especially in Guangdong, Fujian. Search for dried seafood wholesalers in Guangzhou Yide Road market, Hong Kong Sheung Wan dried seafood street, and Fujian dried seafood processors. Return JSON array: [{\"company\":\"...\",\"city\":\"...\",\"segment\":\"dried seafood wholesale/retail/TCM\",\"estimatedVolume\":\"...\",\"source\":\"...\",\"contactHint\":\"...\"}]" },
    ];

    const results = [];
    for (const seg of segments) {
      addLog(`Researching: ${seg.segment}...`);
      try {
        const raw = await askClaude(seg.query);
        try {
          const cleaned = raw.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          results.push({ segment: seg.segment, buyers: parsed });
          addLog(`  → ${parsed.length} companies identified`, "success");
        } catch {
          results.push({ segment: seg.segment, buyers: [], rawResponse: raw });
          addLog(`  → Response received (text format)`, "warn");
        }
      } catch (err) {
        addLog(`  ✗ Error: ${err.message}`, "error");
        results.push({ segment: seg.segment, buyers: [], error: err.message });
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    setBuyerData(results);
    setLoading(p => ({ ...p, buyer: false }));
    addLog("Buyer identification complete!", "success");
  }, [addLog]);

  // ── GRADE SPECIFICATIONS (Claude AI) ────────────────────────────
  const fetchSpecs = useCallback(async () => {
    setLoading(p => ({ ...p, spec: true }));
    addLog("Researching product grade specifications...", "info");

    const specQueries = [
      { product: "Hydroxyapatite", query: `Search for detailed specifications for each grade of hydroxyapatite powder. Cover: Industrial (>95%), Food/Cosmetic (>98%), Toothpaste nano-HAp, Medical/Surgical (>99.5%). For each grade find: purity %, particle size range, Ca/P molar ratio, heavy metal limits (Pb, As, Cd, Hg), relevant standards (USP, EP, ISO 13779, SCCS), crystallinity requirements, typical applications, and key quality tests (XRD, FTIR, BET surface area). Return JSON array: [{"grade":"...","purity":"...","particleSize":"...","caP_ratio":"...","heavyMetals":{"Pb":"<10ppm","As":"..."},"standards":["USP","ISO 13779"],"crystallinity":"...","applications":["oral care","bone graft"],"keyTests":["XRD","FTIR","BET"]}]` },
      { product: "Ground Calcium Carbonate (GCC)", query: `Search for specifications of GCC grades: Filler grade (plastics/rubber), Paper coating grade, Food grade (E170), Pharma grade. For each: CaCO3 purity %, whiteness (L*), particle size (D50, D97), moisture, oil absorption, heavy metals, relevant BIS/FSSAI/USP standards. Return JSON array: [{"grade":"...","purity":"...","whiteness":"...","particleSize":"D50=X, D97=Y","moisture":"...","heavyMetals":{"Pb":"..."},"standards":["IS 1527"],"applications":["plastics","paper"]}]` },
      { product: "Calcium Oxide (CaO)", query: `Search for specifications of calcium oxide grades: Industrial quicklime, Water treatment grade, Food grade (E529). For each: CaO %, MgO %, SiO2 %, Fe2O3 %, loss on ignition, particle size, reactivity (slaking time), relevant IS 712 / FSSAI standards. Return JSON array: [{"grade":"...","CaO_pct":"...","impurities":{"MgO":"...","SiO2":"..."},"reactivity":"...","standards":["IS 712"],"applications":["steel","water treatment"]}]` },
      { product: "Frozen Clam Meat (Export Grade)", query: `Search for export specifications for frozen clam meat products, especially for China/SE Asia markets. Cover these product forms: IQF (Individually Quick Frozen) shell-on clams, IQF shucked clam meat, block frozen clam meat, blanched frozen clam meat. Species focus: Villorita cyprinoides (Indian black clam), Corbicula (Asian clam), Meretrix meretrix (yellow clam). For each find: moisture content, protein content, glaze percentage, bacterial limits (TPC, E.coli, Salmonella, V.parahaemolyticus), heavy metals (Pb, Cd, Hg, As), packaging specs, storage temp, shelf life, GACC/EIC requirements, relevant FSSAI/Codex standards. Return JSON array: [{"grade":"IQF shucked","moisture":"...","protein":"...","glaze":"...","bacterialLimits":{"TPC":"...","Salmonella":"..."},"heavyMetals":{"Pb":"..."},"storage":"...","shelfLife":"...","standards":["FSSAI","Codex"],"applications":["hotpot","restaurant","retail"]}]` },
      { product: "Dried Clam Meat (Export Grade)", query: `Search for specifications for dried clam meat products for export to China and Hong Kong. Cover: sun-dried whole clam, oven-dried clam meat, smoked clam, salted-dried clam. Species: Villorita cyprinoides, Meretrix (yellow clam), Corbicula. For each find: moisture content (target <15%), water activity (Aw), protein content, salt content, bacterial limits, heavy metals, packaging, shelf life, and relevant food safety standards for China import (GB standards). Dried clam is a premium product in Guangdong/Fujian cuisine. Return JSON array: [{"grade":"oven-dried","moisture":"...","waterActivity":"...","protein":"...","salt":"...","bacterialLimits":{"TPC":"..."},"heavyMetals":{"Pb":"..."},"shelfLife":"...","standards":["GB 10136","FSSAI"],"applications":["Cantonese soup","stir-fry","TCM"]}]` },
    ];

    const results = [];
    for (const sq of specQueries) {
      addLog(`Researching ${sq.product} specifications...`);
      try {
        const raw = await askClaude(sq.query);
        try {
          const cleaned = raw.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          results.push({ product: sq.product, specs: parsed });
          addLog(`  → ${parsed.length} grades documented`, "success");
        } catch {
          results.push({ product: sq.product, specs: [], rawResponse: raw });
          addLog(`  → Response received (text format)`, "warn");
        }
      } catch (err) {
        addLog(`  ✗ Error: ${err.message}`, "error");
        results.push({ product: sq.product, specs: [], error: err.message });
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    setSpecData(results);
    setLoading(p => ({ ...p, spec: false }));
    addLog("Specification research complete!", "success");
  }, [addLog]);

  // ── RENDER ───────────────────────────────────────────────────────
  const tabs = [
    { id: "trade", label: "Trade Flows", icon: "⛴", desc: "UN Comtrade" },
    { id: "price", label: "Pricing", icon: "💰", desc: "AI Research" },
    { id: "buyer", label: "Buyers", icon: "🏭", desc: "AI Research" },
    { id: "spec", label: "Grade Specs", icon: "🔬", desc: "AI Research" },
  ];

  return (
    <div style={{
      fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
      background: "#0a0f1a",
      color: "#e2e8f0",
      minHeight: "100vh",
      padding: 0,
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
        borderBottom: "1px solid rgba(99,102,241,0.3)",
        padding: "20px 24px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 8,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 900, color: "#fff",
          }}>R</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.02em" }}>
              Relish Market Intelligence
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
              CalciWorks · Shell Derivatives · Clam Meat Products · Real-Time Data Collection
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
          {Object.entries(HS_CODES).map(([code, hs]) => (
            <span key={code} style={{
              fontSize: 10, padding: "3px 8px", borderRadius: 4,
              background: hs.color + "22", color: hs.color, border: `1px solid ${hs.color}44`,
              fontFamily: "monospace",
            }}>
              HS {code} · {hs.shortName}
            </span>
          ))}
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: "flex", gap: 2, padding: "12px 24px 0",
        borderBottom: "1px solid #1e293b",
        background: "#0f172a",
      }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: "10px 18px", border: "none", cursor: "pointer",
            borderRadius: "8px 8px 0 0",
            background: activeTab === tab.id ? "#1e293b" : "transparent",
            color: activeTab === tab.id ? "#f8fafc" : "#64748b",
            fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
            display: "flex", alignItems: "center", gap: 8,
            borderBottom: activeTab === tab.id ? "2px solid #6366f1" : "2px solid transparent",
            transition: "all 0.2s",
          }}>
            <span style={{ fontSize: 16 }}>{tab.icon}</span>
            <span>{tab.label}</span>
            <span style={{
              fontSize: 9, padding: "1px 5px", borderRadius: 3,
              background: activeTab === tab.id ? "#6366f122" : "#1e293b",
              color: "#94a3b8",
            }}>{tab.desc}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 0, minHeight: "calc(100vh - 180px)" }}>
        {/* Main Content */}
        <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          {/* ─── TRADE FLOWS TAB ─────────────────────────────── */}
          {activeTab === "trade" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Trade Flow Data</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a3b8" }}>
                    Source: UN Comtrade Free Preview API · HS 6-digit · Annual data
                  </p>
                </div>
                <button onClick={fetchTradeFlows} disabled={loading.trade} style={{
                  padding: "10px 20px", borderRadius: 8, border: "none", cursor: loading.trade ? "wait" : "pointer",
                  background: loading.trade ? "#334155" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  color: "#fff", fontSize: 13, fontWeight: 600,
                  boxShadow: loading.trade ? "none" : "0 4px 12px rgba(99,102,241,0.3)",
                }}>
                  {loading.trade ? "⏳ Fetching from Comtrade..." : "🔄 Fetch Trade Data"}
                </button>
              </div>

              {!tradeData && !loading.trade && (
                <div style={{
                  background: "#1e293b", borderRadius: 12, padding: 40, textAlign: "center",
                  border: "1px dashed #334155",
                }}>
                  <p style={{ fontSize: 40, margin: "0 0 12px" }}>⛴</p>
                  <p style={{ color: "#94a3b8", fontSize: 14 }}>
                    Click "Fetch Trade Data" to pull real trade flows from UN Comtrade
                  </p>
                  <p style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>
                    Fetches China imports + India exports for all 6 HS codes · ~30 API calls · Takes 2-3 min
                  </p>
                </div>
              )}

              {tradeData && (
                <div>
                  {/* China Imports Section */}
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: "#f59e0b", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    🇨🇳 China Imports by Partner (2023)
                  </h3>
                  {Object.entries(tradeData.chinaImports).map(([code, rows]) => {
                    if (!rows.length) return null;
                    const hs = HS_CODES[code];
                    const totalVal = rows.reduce((s, r) => s + (r.value || 0), 0);
                    return (
                      <div key={code} style={{
                        background: "#1e293b", borderRadius: 10, marginBottom: 16,
                        border: `1px solid ${hs.color}33`, overflow: "hidden",
                      }}>
                        <div style={{
                          padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center",
                          background: hs.color + "11", borderBottom: `1px solid ${hs.color}22`,
                        }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>
                            <span style={{ color: hs.color }}>HS {code}</span> · {hs.name}
                          </span>
                          <span style={{ fontSize: 12, color: "#94a3b8" }}>
                            Total: {fmtUSD(totalVal)}
                          </span>
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                              <tr style={{ borderBottom: "1px solid #334155" }}>
                                {["#", "Partner", "Value (USD)", "Net Weight", "Unit Price ($/MT)", "Share"].map(h => (
                                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#64748b", fontWeight: 500, fontSize: 11 }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.slice(0, 10).map((r, i) => (
                                <tr key={i} style={{ borderBottom: "1px solid #1e293b44" }}>
                                  <td style={{ padding: "6px 12px", color: "#64748b" }}>{i + 1}</td>
                                  <td style={{ padding: "6px 12px", fontWeight: 500, color: r.partner === "India" ? "#f59e0b" : "#e2e8f0" }}>
                                    {r.partner} {r.partner === "India" && "★"}
                                  </td>
                                  <td style={{ padding: "6px 12px", fontFamily: "monospace" }}>{fmtUSD(r.value)}</td>
                                  <td style={{ padding: "6px 12px", fontFamily: "monospace" }}>{r.netWeight ? fmtMT(r.netWeight) : "—"}</td>
                                  <td style={{ padding: "6px 12px", fontFamily: "monospace", color: hs.color }}>{r.unitPrice ? fmtPrice(r.unitPrice) : "—"}</td>
                                  <td style={{ padding: "6px 12px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <div style={{
                                        width: 60, height: 6, background: "#0f172a", borderRadius: 3, overflow: "hidden",
                                      }}>
                                        <div style={{
                                          width: `${Math.min(100, (r.value / totalVal) * 100)}%`,
                                          height: "100%", background: hs.color, borderRadius: 3,
                                        }} />
                                      </div>
                                      <span style={{ fontSize: 10, color: "#94a3b8" }}>
                                        {totalVal > 0 ? ((r.value / totalVal) * 100).toFixed(1) + "%" : "—"}
                                      </span>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}

                  {/* India Exports Section */}
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: "#10b981", margin: "24px 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    🇮🇳 India Exports by Destination (2023)
                  </h3>
                  {Object.entries(tradeData.indiaExports).map(([code, rows]) => {
                    if (!rows.length) return null;
                    const hs = HS_CODES[code];
                    return (
                      <div key={code} style={{
                        background: "#1e293b", borderRadius: 10, marginBottom: 12,
                        border: `1px solid ${hs.color}22`, padding: "10px 16px",
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                          <span style={{ color: hs.color }}>HS {code}</span> · {hs.shortName} — Top destinations
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {rows.slice(0, 8).map((r, i) => (
                            <span key={i} style={{
                              fontSize: 11, padding: "4px 10px", borderRadius: 6,
                              background: i === 0 ? hs.color + "22" : "#0f172a",
                              border: `1px solid ${hs.color}${i === 0 ? "44" : "11"}`,
                              color: i === 0 ? hs.color : "#94a3b8",
                            }}>
                              {r.partner}: {fmtUSD(r.value)}
                              {r.unitPrice ? ` (${fmtPrice(r.unitPrice)}/MT)` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* Time Series */}
                  {Object.keys(tradeData.timeSeries).length > 0 && (
                    <>
                      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#8b5cf6", margin: "24px 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        📈 China Import Trend (2020–2023)
                      </h3>
                      {Object.entries(tradeData.timeSeries).map(([code, years]) => {
                        const hs = HS_CODES[code];
                        const vals = Object.values(years).map(y => y.value);
                        const maxVal = Math.max(...vals, 1);
                        return (
                          <div key={code} style={{
                            background: "#1e293b", borderRadius: 10, padding: 16, marginBottom: 12,
                            border: `1px solid ${hs.color}22`,
                          }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
                              <span style={{ color: hs.color }}>HS {code}</span> · {hs.shortName}
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 80 }}>
                              {Object.entries(years).map(([yr, d]) => (
                                <div key={yr} style={{ flex: 1, textAlign: "center" }}>
                                  <div style={{
                                    height: `${Math.max(4, (d.value / maxVal) * 60)}px`,
                                    background: `linear-gradient(180deg, ${hs.color}, ${hs.color}88)`,
                                    borderRadius: "4px 4px 0 0", margin: "0 auto",
                                    width: "70%", transition: "height 0.5s",
                                  }} />
                                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{yr}</div>
                                  <div style={{ fontSize: 10, color: hs.color, fontFamily: "monospace" }}>
                                    {d.value > 0 ? "$" + (d.value / 1e6).toFixed(1) + "M" : "—"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {/* Species Reference */}
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: "#0891b2", margin: "24px 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    🐚 Target Clam Species
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
                    {CLAM_SPECIES.map((sp, i) => (
                      <div key={i} style={{
                        background: "#1e293b", borderRadius: 10, padding: 14,
                        border: "1px solid #0891b222",
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#22d3ee", fontStyle: "italic" }}>{sp.scientific}</div>
                        <div style={{ fontSize: 12, color: "#e2e8f0", marginTop: 4 }}>{sp.common}</div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>📍 {sp.region}</div>
                        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4, lineHeight: 1.4 }}>{sp.notes}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── PRICING TAB ─────────────────────────────────── */}
          {activeTab === "price" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Live Pricing Intelligence</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a3b8" }}>
                    Source: Claude AI web research · Alibaba · Made-in-China · IndiaMART · Industry reports
                  </p>
                </div>
                <button onClick={fetchPricing} disabled={loading.price} style={{
                  padding: "10px 20px", borderRadius: 8, border: "none", cursor: loading.price ? "wait" : "pointer",
                  background: loading.price ? "#334155" : "linear-gradient(135deg, #f59e0b, #d97706)",
                  color: "#fff", fontSize: 13, fontWeight: 600,
                }}>
                  {loading.price ? "⏳ AI Researching..." : "🔍 Research Pricing"}
                </button>
              </div>

              {!priceData && !loading.price && (
                <div style={{ background: "#1e293b", borderRadius: 12, padding: 40, textAlign: "center", border: "1px dashed #334155" }}>
                  <p style={{ fontSize: 40, margin: "0 0 12px" }}>💰</p>
                  <p style={{ color: "#94a3b8", fontSize: 14 }}>Claude AI will search the web for current bulk pricing across all product grades</p>
                  <p style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>Searches Alibaba, Made-in-China, IndiaMART, ChemAnalyst · Takes 1-2 min</p>
                </div>
              )}

              {priceData && priceData.map((prod, pi) => (
                <div key={pi} style={{
                  background: "#1e293b", borderRadius: 10, marginBottom: 16,
                  border: "1px solid #334155", overflow: "hidden",
                }}>
                  <div style={{ padding: "10px 16px", background: "#6366f111", borderBottom: "1px solid #334155" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{prod.product}</span>
                  </div>
                  {prod.grades.length > 0 ? (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #334155" }}>
                          {["Grade", "Price Range", "Unit", "MOQ", "Source", "Notes"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#64748b", fontWeight: 500, fontSize: 11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {prod.grades.map((g, gi) => (
                          <tr key={gi} style={{ borderBottom: "1px solid #1e293b44" }}>
                            <td style={{ padding: "6px 12px", fontWeight: 500 }}>{g.grade}</td>
                            <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#10b981" }}>
                              {g.priceMin != null ? `$${g.priceMin} – $${g.priceMax}` : "—"}
                            </td>
                            <td style={{ padding: "6px 12px", color: "#94a3b8" }}>{g.unit || "—"}</td>
                            <td style={{ padding: "6px 12px", color: "#94a3b8" }}>{g.moq || "—"}</td>
                            <td style={{ padding: "6px 12px", color: "#94a3b8" }}>{g.source || "—"}</td>
                            <td style={{ padding: "6px 12px", color: "#64748b", fontSize: 11 }}>{g.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: 16, color: "#94a3b8", fontSize: 12 }}>
                      {prod.rawResponse ? (
                        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 1.5 }}>
                          {prod.rawResponse.slice(0, 1500)}
                        </pre>
                      ) : prod.error ? (
                        <span style={{ color: "#ef4444" }}>Error: {prod.error}</span>
                      ) : "No data"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ─── BUYERS TAB ──────────────────────────────────── */}
          {activeTab === "buyer" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Buyer Identification</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a3b8" }}>
                    Source: Claude AI web research · Trade directories · Industry databases
                  </p>
                </div>
                <button onClick={fetchBuyers} disabled={loading.buyer} style={{
                  padding: "10px 20px", borderRadius: 8, border: "none", cursor: loading.buyer ? "wait" : "pointer",
                  background: loading.buyer ? "#334155" : "linear-gradient(135deg, #10b981, #059669)",
                  color: "#fff", fontSize: 13, fontWeight: 600,
                }}>
                  {loading.buyer ? "⏳ AI Researching..." : "🏭 Find Buyers"}
                </button>
              </div>

              {!buyerData && !loading.buyer && (
                <div style={{ background: "#1e293b", borderRadius: 12, padding: 40, textAlign: "center", border: "1px dashed #334155" }}>
                  <p style={{ fontSize: 40, margin: "0 0 12px" }}>🏭</p>
                  <p style={{ color: "#94a3b8", fontSize: 14 }}>Claude AI will search for buyers across China HAp, CaCO3, India domestic, and Clam importers</p>
                </div>
              )}

              {buyerData && buyerData.map((seg, si) => (
                <div key={si} style={{
                  background: "#1e293b", borderRadius: 10, marginBottom: 16,
                  border: "1px solid #334155", overflow: "hidden",
                }}>
                  <div style={{
                    padding: "10px 16px", background: "#10b98111", borderBottom: "1px solid #334155",
                    fontSize: 13, fontWeight: 600,
                  }}>
                    {seg.segment}
                    {seg.buyers.length > 0 && (
                      <span style={{ fontSize: 11, color: "#10b981", marginLeft: 8 }}>
                        ({seg.buyers.length} companies)
                      </span>
                    )}
                  </div>
                  {seg.buyers.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8, padding: 12 }}>
                      {seg.buyers.map((b, bi) => (
                        <div key={bi} style={{
                          background: "#0f172a", borderRadius: 8, padding: "10px 14px",
                          border: "1px solid #334155",
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#f8fafc", marginBottom: 4 }}>{b.company}</div>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>
                            {b.city && <span>📍 {b.city} · </span>}
                            {b.segment && <span style={{ color: "#6366f1" }}>{b.segment}</span>}
                          </div>
                          {b.estimatedVolume && (
                            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Vol: {b.estimatedVolume}</div>
                          )}
                          {b.source && (
                            <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Source: {b.source}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: 16, color: "#94a3b8", fontSize: 12 }}>
                      {seg.rawResponse ? (
                        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 11 }}>{seg.rawResponse.slice(0, 1500)}</pre>
                      ) : seg.error ? (
                        <span style={{ color: "#ef4444" }}>Error: {seg.error}</span>
                      ) : "No data"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ─── GRADE SPECS TAB ─────────────────────────────── */}
          {activeTab === "spec" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Product Grade Specifications</h2>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a3b8" }}>
                    Source: Claude AI research · USP · ISO · BIS · FSSAI · EU SCCS
                  </p>
                </div>
                <button onClick={fetchSpecs} disabled={loading.spec} style={{
                  padding: "10px 20px", borderRadius: 8, border: "none", cursor: loading.spec ? "wait" : "pointer",
                  background: loading.spec ? "#334155" : "linear-gradient(135deg, #dc2626, #b91c1c)",
                  color: "#fff", fontSize: 13, fontWeight: 600,
                }}>
                  {loading.spec ? "⏳ AI Researching..." : "🔬 Research Specs"}
                </button>
              </div>

              {!specData && !loading.spec && (
                <div style={{ background: "#1e293b", borderRadius: 12, padding: 40, textAlign: "center", border: "1px dashed #334155" }}>
                  <p style={{ fontSize: 40, margin: "0 0 12px" }}>🔬</p>
                  <p style={{ color: "#94a3b8", fontSize: 14 }}>Claude AI will research detailed specs for each grade of HAp, GCC, and CaO</p>
                  <p style={{ color: "#64748b", fontSize: 12, marginTop: 8 }}>
                    Purity, particle size, Ca/P ratio, heavy metals limits, applicable standards, quality tests
                  </p>
                </div>
              )}

              {specData && specData.map((prod, pi) => (
                <div key={pi} style={{
                  background: "#1e293b", borderRadius: 10, marginBottom: 20,
                  border: "1px solid #334155", overflow: "hidden",
                }}>
                  <div style={{
                    padding: "10px 16px", background: "#dc262611", borderBottom: "1px solid #334155",
                    fontSize: 14, fontWeight: 700,
                  }}>
                    {prod.product}
                  </div>
                  {prod.specs.length > 0 ? (
                    <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
                      {prod.specs.map((s, si) => (
                        <div key={si} style={{
                          background: "#0f172a", borderRadius: 8, padding: 14,
                          border: "1px solid #334155",
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b", marginBottom: 8, textTransform: "uppercase" }}>
                            {s.grade}
                          </div>
                          <div style={{ fontSize: 11, lineHeight: 1.8, color: "#cbd5e1" }}>
                            {s.purity && <div><span style={{ color: "#64748b" }}>Purity:</span> {s.purity}</div>}
                            {s.CaO_pct && <div><span style={{ color: "#64748b" }}>CaO%:</span> {s.CaO_pct}</div>}
                            {s.particleSize && <div><span style={{ color: "#64748b" }}>Particle Size:</span> {s.particleSize}</div>}
                            {s.caP_ratio && <div><span style={{ color: "#64748b" }}>Ca/P Ratio:</span> {s.caP_ratio}</div>}
                            {s.whiteness && <div><span style={{ color: "#64748b" }}>Whiteness:</span> {s.whiteness}</div>}
                            {s.moisture && <div><span style={{ color: "#64748b" }}>Moisture:</span> {s.moisture}</div>}
                            {s.crystallinity && <div><span style={{ color: "#64748b" }}>Crystallinity:</span> {s.crystallinity}</div>}
                            {s.reactivity && <div><span style={{ color: "#64748b" }}>Reactivity:</span> {s.reactivity}</div>}
                            {s.heavyMetals && typeof s.heavyMetals === "object" && (
                              <div>
                                <span style={{ color: "#64748b" }}>Heavy Metals:</span>{" "}
                                {Object.entries(s.heavyMetals).map(([k, v]) => `${k}: ${v}`).join(", ")}
                              </div>
                            )}
                            {s.impurities && typeof s.impurities === "object" && (
                              <div>
                                <span style={{ color: "#64748b" }}>Impurities:</span>{" "}
                                {Object.entries(s.impurities).map(([k, v]) => `${k}: ${v}`).join(", ")}
                              </div>
                            )}
                            {s.standards && Array.isArray(s.standards) && (
                              <div>
                                <span style={{ color: "#64748b" }}>Standards:</span>{" "}
                                {s.standards.map((st, i) => (
                                  <span key={i} style={{
                                    fontSize: 10, padding: "1px 6px", borderRadius: 3,
                                    background: "#6366f122", color: "#818cf8", marginRight: 4,
                                  }}>{st}</span>
                                ))}
                              </div>
                            )}
                            {s.applications && Array.isArray(s.applications) && (
                              <div style={{ marginTop: 4 }}>
                                <span style={{ color: "#64748b" }}>Uses:</span>{" "}
                                {s.applications.join(", ")}
                              </div>
                            )}
                            {s.keyTests && Array.isArray(s.keyTests) && (
                              <div>
                                <span style={{ color: "#64748b" }}>QC Tests:</span>{" "}
                                {s.keyTests.join(", ")}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: 16, color: "#94a3b8", fontSize: 12 }}>
                      {prod.rawResponse ? (
                        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 11 }}>{prod.rawResponse.slice(0, 2000)}</pre>
                      ) : "No data"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Log Sidebar */}
        <div style={{
          width: 300, background: "#0f172a", borderLeft: "1px solid #1e293b",
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e293b", fontSize: 12, fontWeight: 600, color: "#64748b" }}>
            📋 ACTIVITY LOG
          </div>
          <div ref={logRef} style={{
            flex: 1, overflowY: "auto", padding: "8px 12px",
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, lineHeight: 1.6,
          }}>
            {logs.length === 0 && (
              <div style={{ color: "#334155", padding: 12, textAlign: "center" }}>
                Waiting for commands...
              </div>
            )}
            {logs.map((l, i) => (
              <div key={i} style={{
                color: l.type === "error" ? "#ef4444" : l.type === "success" ? "#10b981" : l.type === "warn" ? "#f59e0b" : "#64748b",
                borderBottom: "1px solid #1e293b22", padding: "3px 0",
              }}>
                <span style={{ color: "#334155" }}>[{l.ts}]</span> {l.msg}
              </div>
            ))}
          </div>
          {/* Status indicators */}
          <div style={{ padding: "8px 12px", borderTop: "1px solid #1e293b", fontSize: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "#64748b" }}>Comtrade API</span>
              <span style={{ color: tradeData ? "#10b981" : "#64748b" }}>{tradeData ? "✓ Loaded" : "○ Ready"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "#64748b" }}>Price Intel</span>
              <span style={{ color: priceData ? "#10b981" : "#64748b" }}>{priceData ? "✓ Loaded" : "○ Ready"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "#64748b" }}>Buyers</span>
              <span style={{ color: buyerData ? "#10b981" : "#64748b" }}>{buyerData ? "✓ Loaded" : "○ Ready"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#64748b" }}>Grade Specs</span>
              <span style={{ color: specData ? "#10b981" : "#64748b" }}>{specData ? "✓ Loaded" : "○ Ready"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
