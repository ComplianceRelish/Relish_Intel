#!/usr/bin/env python3
"""
Relish Trade Intelligence — Export Market Monitor Scraper
=========================================================

PRIMARY product : HS 03073910 — Clams & Clam Meat (Villorita / Meretrix / Katelysia)
                  Exported from India to East Asia (China, Japan, South Korea, Vietnam…)

  Species under this code:
    Villorita cyprinoides — Kakka / Indian Black Clam, Kerala backwaters
                            Relish's primary raw material (Panavally)
    Meretrix meretrix     — Hard clam / Indian Venus clam (Kerala, TN, AP coasts)
    Katelysia spp.        — Carpet clams (Kerala/coastal India)

SHELL DERIVATIVES — by-products from processing the shells of HS 03073910
  ┌──────────┬────────────────────────────────────────────────────────┐
  │ 282510   │ Calcium Oxide (CaO / Quicklime) — shell calcination    │
  │ 283526   │ Calcium Phosphates (DCP/TCP/HAp) — mineral processing  │
  │ 283650   │ Calcium Carbonate (CaCO3/GCC) — ground shell direct    │
  └──────────┴────────────────────────────────────────────────────────┘

Free data sources queried (in order of reliability):
  1. UN Comtrade public preview API  — comtradeapi.un.org          (no key needed)
  2. WITS World Bank SDMX REST API   — wits.worldbank.org          (no key needed)
  3. TRADESTAT / DGCI&S form scrape  — tradestat.commerce.gov.in  (form scrape)
  4. MPEDA FishEx stats page         — mpeda.gov.in               (HTML scrape)

Output (written to ./output/):
  relish_trade_data_YYYYMMDD_HHMMSS.csv   ← load this into the dashboard
  relish_trade_data_YYYYMMDD_HHMMSS.xlsx  ← sheets: All, CLAM, CALCIUM
  relish_trade_data_YYYYMMDD_HHMMSS.json  ← for API/programmatic use
  relish_master.csv                        ← rolling append of all runs

Install:
  pip install requests beautifulsoup4 pandas openpyxl lxml schedule

Usage:
  python scraper.py                                    # all codes, last 2 years
  python scraper.py --years 2022 2023 2024             # specific years
  python scraper.py --hs 03073910 283650               # specific HS codes only
  python scraper.py --sources comtrade wits            # specific sources only
  python scraper.py --years 2024 --hs 03073910         # combined filters
"""

from __future__ import annotations

import argparse
import csv
import datetime
import json
import logging
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional

import requests
from bs4 import BeautifulSoup
import pandas as pd

# ── Output directory & logging ────────────────────────────────────────────────
OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(OUTPUT_DIR / "scraper.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("relish")

# ── HS Code registry ──────────────────────────────────────────────────────────
# 03073910 is the PRIMARY ITC-HS 8-digit code for India's backwater clam exports.
# Shell derivatives (282510, 283526, 283650) are produced from the by-product
# shells that result from shucking / processing the primary clam species.
HS_REGISTRY: Dict[str, dict] = {
    # ── Primary product ──────────────────────────────────────────────────────
    "03073910": {
        "label":    "Clams & Clam Meat (Villorita/Meretrix/Katelysia)",
        "short":    "Clam Meat",
        "group":    "CLAM",
        "priority": "PRIMARY",
        "ct6":      "030739",   # 6-digit HS used by UN Comtrade / WITS
        "note":     "Villorita cyprinoides (Kakka / Indian Black Clam, Kerala backwaters), "
                    "Meretrix meretrix (Hard clam / Indian Venus clam), Katelysia spp. (Carpet clams). "
                    "Primary raw material at Relish Panavally. Shell derivatives (282510/283526/283650) "
                    "produced from shells. Use full 8-digit 03073910 on all Indian export docs.",
    },
    # ── Other clam / shellfish codes ─────────────────────────────────────────
    "030771": {
        "label":    "Clams, Live / Fresh / Chilled",
        "short":    "Clams-Live",
        "group":    "CLAM",
        "priority": "HIGH",
        "ct6":      "030771",
    },
    "030772": {
        "label":    "Clams, Frozen (in/out shell)",
        "short":    "Clams-Frozen",
        "group":    "CLAM",
        "priority": "HIGH",
        "ct6":      "030772",
    },
    "030779": {
        "label":    "Clams, Dried / Salted / Smoked",
        "short":    "Clams-Dried",
        "group":    "CLAM",
        "priority": "HIGH",
        "ct6":      "030779",
    },
    "030791": {
        "label":    "Molluscs n.e.s., Live / Fresh",
        "short":    "Molluscs",
        "group":    "CLAM",
        "priority": "MEDIUM",
        "ct6":      "030791",
    },
    "160556": {
        "label":    "Clams, Prepared / Preserved",
        "short":    "Clams-Prep",
        "group":    "CLAM",
        "priority": "HIGH",
        "ct6":      "160556",
    },
    # ── Shell derivatives (by-product of 03073910 processing) ────────────────
    "282510": {
        "label":    "Calcium Oxide (CaO / Quicklime)",
        "short":    "CaO",
        "group":    "CALCIUM",
        "priority": "HIGH",
        "ct6":      "282510",
        "note":     "Shell derivative — produced by calcination of clam shells",
    },
    "283526": {
        "label":    "Calcium Phosphates (DCP / TCP / HAp)",
        "short":    "Ca-Phosphates",
        "group":    "CALCIUM",
        "priority": "HIGH",
        "ct6":      "283526",
        "note":     "Shell derivative — mineral processing of clam shells",
    },
    "283650": {
        "label":    "Calcium Carbonate (CaCO3 / GCC)",
        "short":    "CaCO3",
        "group":    "CALCIUM",
        "priority": "HIGH",
        "ct6":      "283650",
        "note":     "Shell derivative — CaCO3 ground directly from clam shells",
    },
    "291811": {
        "label":    "Lactic Acid & Salts (Ca-Lactate)",
        "short":    "Ca-Lactate",
        "group":    "CALCIUM",
        "priority": "MEDIUM",
        "ct6":      "291811",
    },
}

# India's UN/WITS reporter code
INDIA_CODE = "356"
INDIA_ISO   = "IND"

# Polite delay between HTTP requests to any one domain (seconds)
REQUEST_DELAY = 1.5

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


# ── Data model ────────────────────────────────────────────────────────────────
@dataclass
class TradeRecord:
    """Single trade flow record — matches the dashboard CSV schema."""
    source:       str            = ""
    hs_code:      str            = ""
    product:      str            = ""
    country:      str            = ""
    qty_kgs:      Optional[float] = None   # raw quantity in kilograms
    value_inr_cr: Optional[float] = None   # value in ₹ Crores
    value_usd_mn: Optional[float] = None   # value in USD Millions
    period:       str            = ""      # e.g. "2024", "Apr-Dec 2025"
    type:         str            = "EXPORT"
    group:        str            = ""      # "CLAM" | "CALCIUM"
    notes:        str            = ""
    scraped_at:   str            = ""

    # ── Computed unit-price helpers (not stored — added at export time) ──────
    @property
    def usd_per_kg(self) -> Optional[float]:
        if self.qty_kgs and self.value_usd_mn:
            return (self.value_usd_mn * 1_000_000) / self.qty_kgs
        return None

    @property
    def usd_per_mt(self) -> Optional[float]:
        v = self.usd_per_kg
        return v * 1_000 if v is not None else None


# ── Utility helpers ───────────────────────────────────────────────────────────
def _now() -> str:
    return datetime.datetime.utcnow().isoformat(timespec="seconds")


def _to_float(value) -> Optional[float]:
    """Convert a value to float, stripping commas and whitespace."""
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except (ValueError, TypeError):
        return None


def _active_codes(codes_filter: Optional[List[str]]) -> List[str]:
    if codes_filter:
        return [c for c in codes_filter if c in HS_REGISTRY]
    return list(HS_REGISTRY.keys())


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  SOURCE 1 — UN Comtrade Public Preview API                                 ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
class ComtradeScraper:
    """
    Free public preview endpoint — requires no API key.
    Returns up to 500 records per call, FOB USD values.

    Endpoint: GET https://comtradeapi.un.org/public/v1/preview/C/A/HS
    reporter 356 = India  |  flowCode X = Exports
    """

    BASE = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"

    def _fetch_one(self, hs_code: str, year: int) -> List[TradeRecord]:
        meta = HS_REGISTRY[hs_code]
        cmd  = meta["ct6"]  # Comtrade works best with 6-digit

        params = {
            "reporterCode": INDIA_CODE,
            "cmdCode":      cmd,
            "flowCode":     "X",
            "period":       str(year),
        }

        try:
            resp = requests.get(
                self.BASE, params=params, headers=_HEADERS, timeout=30
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:
            log.warning(f"  Comtrade [{hs_code}/{year}] — {exc}")
            return []

        records: List[TradeRecord] = []
        for row in payload.get("data", []):
            partner = (
                row.get("partnerDesc")
                or row.get("partner2Desc")
                or str(row.get("partnerCode", ""))
            ).upper().strip()

            # Skip aggregate / world rows
            if not partner or partner in ("WORLD", "0", "ALL", ""):
                continue

            # Quantity: prefer altQty in KGM
            qty = None
            if row.get("altQtyUnitAbbr") in ("KGM", "kg", "KG"):
                qty = _to_float(row.get("altQty"))
            if qty is None:
                qty = _to_float(row.get("netWeightKg"))

            # Value: primaryValue is FOB USD
            val_usd   = _to_float(row.get("primaryValue") or row.get("TradeValue"))
            val_usd_mn = (val_usd / 1_000_000) if val_usd else None

            records.append(TradeRecord(
                source="COMTRADE",
                hs_code=hs_code,
                product=meta["label"],
                country=partner,
                qty_kgs=qty,
                value_usd_mn=val_usd_mn,
                period=str(year),
                group=meta["group"],
                scraped_at=_now(),
            ))

        log.info(f"  Comtrade [{hs_code}/{year}]: {len(records)} partner rows")
        return records

    def run(self, years: List[int], codes: Optional[List[str]] = None) -> List[TradeRecord]:
        log.info("── Source 1: UN Comtrade (public preview) ────────────────")
        out: List[TradeRecord] = []
        for code in _active_codes(codes):
            for yr in years:
                out.extend(self._fetch_one(code, yr))
                time.sleep(REQUEST_DELAY)
        log.info(f"  Comtrade total: {len(out)} records")
        return out


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  SOURCE 2 — WITS World Bank (SDMX REST API)                                ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
class WITSScraper:
    """
    World Integrated Trade Solution (World Bank).
    REST API returns SDMX-ML XML — no API key required.
    Annual data, USD CIF/FOB values, partner-level breakdown.
    Docs: https://wits.worldbank.org/wits/wits/WITSAPI.aspx
    """

    # tradestats-trade = merchandise trade statistics
    _URL = (
        "https://wits.worldbank.org/API/V1/SDMX/V21"
        "/datasource/tradestats-trade"
        "/reporter/{reporter}"
        "/year/{year}"
        "/partner/ALL"
        "/product/{hs6}"
        "/indicator/XPRT-VAL"
    )

    # SDMX namespace map
    _NS = {
        "g": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic",
        "m": "http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message",
    }

    def _fetch_one(self, hs_code: str, year: int) -> List[TradeRecord]:
        meta = HS_REGISTRY[hs_code]
        url  = self._URL.format(reporter=INDIA_ISO, year=year, hs6=meta["ct6"])

        try:
            resp = requests.get(url, headers=_HEADERS, timeout=45)
            if resp.status_code == 404:
                log.debug(f"  WITS [{hs_code}/{year}]: 404 — no data for this period")
                return []
            resp.raise_for_status()
        except Exception as exc:
            log.warning(f"  WITS [{hs_code}/{year}] — {exc}")
            return []

        return self._parse_sdmx(resp.text, hs_code, meta, year)

    def _parse_sdmx(
        self, xml_text: str, hs_code: str, meta: dict, year: int
    ) -> List[TradeRecord]:
        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError as exc:
            log.warning(f"  WITS XML parse error [{hs_code}/{year}]: {exc}")
            return []

        records: List[TradeRecord] = []
        for series in root.findall(".//g:Series", self._NS):
            dims: Dict[str, str] = {
                kv.get("id", ""): kv.get("value", "")
                for kv in series.findall("g:SeriesKey/g:Value", self._NS)
            }
            partner = dims.get("PARTNER", "").upper().strip()
            if not partner or partner in ("WLD", "000", "ALL", ""):
                continue

            for obs in series.findall("g:Obs", self._NS):
                obs_val = obs.find("g:ObsValue", self._NS)
                if obs_val is None:
                    continue
                val_usd = _to_float(obs_val.get("value"))
                if val_usd is None:
                    continue

                records.append(TradeRecord(
                    source="WITS",
                    hs_code=hs_code,
                    product=meta["label"],
                    country=partner,
                    value_usd_mn=val_usd / 1_000_000,
                    period=str(year),
                    group=meta["group"],
                    scraped_at=_now(),
                ))

        log.info(f"  WITS [{hs_code}/{year}]: {len(records)} partner rows")
        return records

    def run(self, years: List[int], codes: Optional[List[str]] = None) -> List[TradeRecord]:
        log.info("── Source 2: WITS World Bank ─────────────────────────────")
        out: List[TradeRecord] = []
        for code in _active_codes(codes):
            for yr in years:
                out.extend(self._fetch_one(code, yr))
                time.sleep(REQUEST_DELAY)
        log.info(f"  WITS total: {len(out)} records")
        return out


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  SOURCE 3 — TRADESTAT / DGCI&S  (tradestat.commerce.gov.in)               ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
class TradeStatScraper:
    """
    India Ministry of Commerce — DGCI&S export statistics portal.
    Form-based HTML scraper: fetches the ASP form, fills HS code + year,
    POSTs back and parses the resulting HTML table.

    Source data is in INR — gives the ₹ Crores column the dashboard needs.
    Uses requests.Session to preserve ASP session cookies.
    """

    BASE      = "https://tradestat.commerce.gov.in"
    FORM_PATH = "/eidb/ihsntq.asp"   # HS-based national export query

    # Common ASP form field name variants used across TRADESTAT form versions
    _HS_FIELDS   = ("cmbhscd", "cmbHsCd", "hscode", "hs_code", "txtHsCd", "ChsCode")
    _YEAR_FIELDS = ("cmbyear", "cmbYear", "year", "selYear", "sel_yr", "Year")

    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update(_HEADERS)

    def _get_hidden_fields(self, url: str) -> dict:
        """Fetch a form page and return all input/select field values."""
        try:
            resp = self._session.get(url, timeout=30)
            resp.raise_for_status()
        except Exception as exc:
            log.warning(f"  TradeSTAT form GET failed: {exc}")
            return {}

        soup = BeautifulSoup(resp.text, "lxml")
        fields: dict = {}
        for el in soup.find_all(["input", "select"]):
            name = el.get("name", "").strip()
            if not name:
                continue
            if el.name == "select":
                opt = el.find("option")
                fields[name] = opt.get("value", "") if opt else ""
            else:
                fields[name] = el.get("value", "")
        return fields

    def _fetch_hs(self, hs_code: str, year: int) -> List[TradeRecord]:
        meta     = HS_REGISTRY[hs_code]
        form_url = self.BASE + self.FORM_PATH

        base_fields = self._get_hidden_fields(form_url)
        if not base_fields:
            return []

        # Build POST body — try all known field name variants for HS + year
        post_data = dict(base_fields)
        for key in self._HS_FIELDS:
            post_data[key] = hs_code.ljust(8, "0")[:8]
        for key in self._YEAR_FIELDS:
            post_data[key] = str(year)
        post_data.setdefault("Submit", "Submit")

        try:
            resp = self._session.post(
                form_url, data=post_data, timeout=45, allow_redirects=True
            )
            resp.raise_for_status()
        except Exception as exc:
            log.warning(f"  TradeSTAT POST [{hs_code}/{year}] failed: {exc}")
            return []

        records = self._parse_table(resp.text, hs_code, meta, year)
        log.info(f"  TradeSTAT [{hs_code}/{year}]: {len(records)} rows parsed")
        return records

    def _parse_table(
        self, html: str, hs_code: str, meta: dict, year: int
    ) -> List[TradeRecord]:
        soup    = BeautifulSoup(html, "lxml")
        records: List[TradeRecord] = []

        for tbl in soup.find_all("table"):
            rows = tbl.find_all("tr")
            if len(rows) < 3:
                continue

            headers = [
                th.get_text(strip=True).lower()
                for th in rows[0].find_all(["th", "td"])
            ]
            header_str = " ".join(headers)
            if not any(k in header_str for k in ("country", "value", "quantity")):
                continue

            for tr in rows[1:]:
                cells = [td.get_text(strip=True) for td in tr.find_all("td")]
                if len(cells) < 3:
                    continue

                country = qty = val_inr = None
                for i, h in enumerate(headers):
                    if i >= len(cells):
                        break
                    cell = cells[i]
                    if "country" in h:
                        country = cell.upper().strip()
                    elif "quantity" in h or "qty" in h:
                        qty = _to_float(cell)
                    elif "value" in h and any(
                        k in h for k in ("inr", "rs", "lakh", "crore", "rupee")
                    ):
                        val_inr = _to_float(cell)

                if not country or country.upper() in ("TOTAL", "GRAND TOTAL", ""):
                    continue

                # TRADESTAT typically reports values in ₹ Lakhs — convert to Crores
                val_inr_cr = None
                if val_inr is not None:
                    if "lakh" in header_str:
                        val_inr_cr = val_inr / 100.0
                    else:
                        val_inr_cr = val_inr  # already crores

                records.append(TradeRecord(
                    source="TRADESTAT",
                    hs_code=hs_code,
                    product=meta["label"],
                    country=country,
                    qty_kgs=qty,
                    value_inr_cr=val_inr_cr,
                    period=str(year),
                    group=meta["group"],
                    scraped_at=_now(),
                ))

        return records

    def run(self, years: List[int], codes: Optional[List[str]] = None) -> List[TradeRecord]:
        log.info("── Source 3: TRADESTAT / DGCI&S ──────────────────────────")
        out: List[TradeRecord] = []
        for code in _active_codes(codes):
            for yr in years:
                out.extend(self._fetch_hs(code, yr))
                time.sleep(REQUEST_DELAY)
        log.info(f"  TRADESTAT total: {len(out)} records")
        return out


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  SOURCE 4 — MPEDA FishEx  (mpeda.gov.in)                                   ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
class MPEDAScraper:
    """
    Marine Products Export Development Authority — India.
    Scrapes the public statistical tables for marine exports by species/country.
    Data is clam-specific and maps to the primary HS code 03073910.
    """

    _STATS_URL = "https://mpeda.gov.in/MPEDA/marine_export_st.php"

    def run(self, years: List[int], codes: Optional[List[str]] = None) -> List[TradeRecord]:
        log.info("── Source 4: MPEDA FishEx ────────────────────────────────")
        out: List[TradeRecord] = []

        # Only relevant for CLAM codes — skip if hs_filter excludes all clam codes
        active = _active_codes(codes)
        if not any(HS_REGISTRY[c]["group"] == "CLAM" for c in active):
            log.info("  MPEDA skipped — no CLAM codes in filter")
            return out

        try:
            resp = requests.get(self._STATS_URL, headers=_HEADERS, timeout=30)
            resp.raise_for_status()
            records = self._parse_mpeda(resp.text, max(years))
            out.extend(records)
        except Exception as exc:
            log.warning(f"  MPEDA fetch failed: {exc}")

        log.info(f"  MPEDA total: {len(out)} records")
        return out

    def _parse_mpeda(self, html: str, latest_year: int) -> List[TradeRecord]:
        """
        MPEDA tables: Species | Country | Quantity (MT) | Value (₹ Cr) | Value (USD Mn)
        Quantity is usually in Metric Tonnes → multiply by 1000 for KGS.
        """
        records: List[TradeRecord] = []
        soup    = BeautifulSoup(html, "lxml")

        for tbl in soup.find_all("table"):
            rows = tbl.find_all("tr")
            if len(rows) < 2:
                continue

            headers = [
                th.get_text(strip=True).lower()
                for th in rows[0].find_all(["th", "td"])
            ]
            header_str = " ".join(headers)
            if not any(k in header_str for k in ("country", "destination")):
                continue

            for tr in rows[1:]:
                cells = [td.get_text(strip=True) for td in tr.find_all("td")]
                if len(cells) < 3:
                    continue

                country = qty_mt = val_inr = val_usd = None
                for i, h in enumerate(headers):
                    if i >= len(cells):
                        break
                    cell = cells[i]
                    if "country" in h or "destination" in h:
                        country = cell.upper().strip()
                    elif "quantity" in h or "qty" in h:
                        qty_mt = _to_float(cell)
                    elif ("usd" in h or "dollar" in h) and "value" in h:
                        val_usd = _to_float(cell)
                    elif "value" in h and any(
                        k in h for k in ("rs", "inr", "crore", "₹", "rupee")
                    ):
                        val_inr = _to_float(cell)

                if not country or country.upper() in ("TOTAL", "GRAND TOTAL", ""):
                    continue

                records.append(TradeRecord(
                    source="MPEDA",
                    hs_code="03073910",
                    product="Marine Products (Clam) — MPEDA",
                    country=country,
                    qty_kgs=(qty_mt * 1_000) if qty_mt else None,
                    value_inr_cr=val_inr,
                    value_usd_mn=val_usd,
                    period=f"FY {latest_year}-{str(latest_year + 1)[2:]}",
                    group="CLAM",
                    scraped_at=_now(),
                ))

        return records


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Output persistence                                                         ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
# CSV column order — matches what the dashboard's loadCSV() expects
_CSV_COLS = [
    "source", "hs_code", "product", "country",
    "qty_kgs", "value_inr_cr", "value_usd_mn",
    "period", "type", "group", "notes", "scraped_at",
    "usd_per_kg", "usd_per_mt",
]


def _records_to_rows(records: List[TradeRecord]) -> List[dict]:
    rows = []
    for rec in records:
        d = asdict(rec)
        d["usd_per_kg"] = f"{rec.usd_per_kg:.4f}" if rec.usd_per_kg else ""
        d["usd_per_mt"] = f"{rec.usd_per_mt:.2f}"  if rec.usd_per_mt else ""
        rows.append(d)
    return rows


def save_output(records: List[TradeRecord], tag: str = "") -> Optional[Path]:
    """
    Save records to CSV, Excel (multi-sheet), and JSON.
    Also appends to the rolling relish_master.csv.
    Returns the path to the timestamped CSV.
    """
    if not records:
        log.warning("No records to save — output skipped.")
        return None

    ts   = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = f"relish_trade_data_{ts}" + (f"_{tag}" if tag else "")
    rows = _records_to_rows(records)

    df = pd.DataFrame(rows)
    # Ensure column order — add missing ones as empty
    for col in _CSV_COLS:
        if col not in df.columns:
            df[col] = ""
    df = df[[c for c in _CSV_COLS if c in df.columns]]

    # ── CSV ────────────────────────────────────────────────────────────────────
    csv_path = OUTPUT_DIR / f"{stem}.csv"
    df.to_csv(csv_path, index=False, encoding="utf-8-sig")
    log.info(f"  CSV  → {csv_path}")

    # ── Excel (one sheet per group + All) ─────────────────────────────────────
    xlsx_path = OUTPUT_DIR / f"{stem}.xlsx"
    try:
        with pd.ExcelWriter(xlsx_path, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="All", index=False)
            for grp in ("CLAM", "CALCIUM"):
                sub = df[df["group"] == grp]
                if not sub.empty:
                    sub.to_excel(writer, sheet_name=grp, index=False)
        log.info(f"  XLSX → {xlsx_path}")
    except Exception as exc:
        log.warning(f"  XLSX write failed: {exc}")

    # ── JSON ───────────────────────────────────────────────────────────────────
    json_path = OUTPUT_DIR / f"{stem}.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2, ensure_ascii=False, default=str)
    log.info(f"  JSON → {json_path}")

    # ── Rolling master CSV (append) ────────────────────────────────────────────
    master_path = OUTPUT_DIR / "relish_master.csv"
    write_header = not master_path.exists()
    with open(master_path, "a", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        if write_header:
            writer.writeheader()
        writer.writerows(rows)
    log.info(f"  MASTER → {master_path}  (+{len(rows)} rows appended)")

    return csv_path


# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  Main orchestrator                                                          ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
def run_all_scrapers(
    years:     Optional[List[int]] = None,
    sources:   Optional[List[str]] = None,
    hs_filter: Optional[List[str]] = None,
) -> List[TradeRecord]:
    """
    Orchestrate all scrapers and persist output.

    Args:
        years:     4-digit years to query.  Default: last 2 complete years.
        sources:   Subset of ["comtrade","wits","tradestat","mpeda"].
                   Default: all sources.
        hs_filter: Only query these HS codes.  Default: all 10 tracked codes.

    Returns:
        Combined list of TradeRecord objects.
    """
    now     = datetime.datetime.now()
    years   = years or [now.year - 1, now.year - 2]
    sources = [s.lower() for s in (sources or ["comtrade", "wits", "tradestat", "mpeda"])]

    log.info("═" * 64)
    log.info("  Relish Trade Intelligence — Export Market Monitor")
    log.info(f"  Primary product  : HS 03073910 (Clams & Clam Meat)")
    log.info(f"  Shell derivatives: 282510 (CaO) · 283526 (CaPO4) · 283650 (CaCO3)")
    log.info(f"  Years  : {years}")
    log.info(f"  Codes  : {hs_filter or f'ALL ({len(HS_REGISTRY)} tracked)'}")
    log.info(f"  Sources: {sources}")
    log.info("═" * 64)

    all_records: List[TradeRecord] = []

    if "comtrade" in sources:
        all_records.extend(ComtradeScraper().run(years, hs_filter))

    if "wits" in sources:
        all_records.extend(WITSScraper().run(years, hs_filter))

    if "tradestat" in sources:
        all_records.extend(TradeStatScraper().run(years, hs_filter))

    if "mpeda" in sources:
        all_records.extend(MPEDAScraper().run(years, hs_filter))

    log.info("─" * 64)
    log.info(f"  Total records collected: {len(all_records)}")

    csv_path = save_output(all_records)
    if csv_path:
        log.info(f"\n  ✅ Done.  Load '{csv_path.name}' into the dashboard.")
        log.info(f"     (Deployment Guide tab → 📂 Load CSV Data)")
    log.info("═" * 64)

    return all_records


# ── CLI entry point ───────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Relish Trade Intelligence — Export Market Monitor Scraper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
HS codes tracked
  03073910  Clams & Clam Meat — PRIMARY (Villorita/Meretrix/Katelysia)
  030771    Clams, Live/Fresh/Chilled
  030772    Clams, Frozen (in/out shell)
  030779    Clams, Dried/Salted/Smoked
  030791    Molluscs n.e.s., Live/Fresh
  160556    Clams, Prepared/Preserved
  282510    Calcium Oxide (CaO) — shell derivative
  283526    Calcium Phosphates (DCP/TCP/HAp) — shell derivative
  283650    Calcium Carbonate (CaCO3/GCC) — shell derivative
  291811    Lactic Acid & Salts (Ca-Lactate)

Examples
  python scraper.py
  python scraper.py --years 2022 2023 2024
  python scraper.py --hs 03073910 283650 282510
  python scraper.py --sources comtrade wits
  python scraper.py --years 2024 --hs 03073910 --sources comtrade
""",
    )
    parser.add_argument(
        "--years", nargs="+", type=int,
        metavar="YEAR",
        help="4-digit years to query (default: last 2 complete years)",
    )
    parser.add_argument(
        "--hs", nargs="+",
        metavar="HS_CODE",
        help="HS codes to query (default: all 10 tracked codes)",
    )
    parser.add_argument(
        "--sources", nargs="+",
        choices=["comtrade", "wits", "tradestat", "mpeda"],
        metavar="SOURCE",
        help="Data sources to run: comtrade wits tradestat mpeda (default: all)",
    )
    args = parser.parse_args()

    run_all_scrapers(
        years=args.years,
        sources=args.sources,
        hs_filter=args.hs,
    )


if __name__ == "__main__":
    main()
