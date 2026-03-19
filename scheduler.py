#!/usr/bin/env python3
"""
Relish Trade Intelligence — Scheduler
======================================

Wraps scraper.py to run automatically on a fixed schedule.

Usage:
  python scheduler.py                          # run once then exit
  python scheduler.py --schedule               # run every 24 h (at 06:00)
  python scheduler.py --schedule --time 09:30  # run daily at 09:30
  python scheduler.py --schedule --interval 12 # run every 12 hours
  python scheduler.py --years 2024 --hs 03073910 --sources comtrade wits

All --years / --hs / --sources flags are passed through to scraper.py.

Install (if not done already):
  pip install requests beautifulsoup4 pandas openpyxl lxml schedule
"""

from __future__ import annotations

import argparse
import datetime
import logging
import sys
import time

import schedule

from scraper import run_all_scrapers

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("relish_scheduler")


def _job(years=None, sources=None, hs_filter=None) -> None:
    log.info(f"\n⏰  Scheduled run started — {datetime.datetime.now().isoformat()}")
    try:
        run_all_scrapers(years=years, sources=sources, hs_filter=hs_filter)
    except Exception as exc:
        log.error(f"Scraper run failed: {exc}", exc_info=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Relish Trade Intelligence — Scheduler",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples
  python scheduler.py                           # one-shot, all codes/sources
  python scheduler.py --schedule                # daily at 06:00, rolling
  python scheduler.py --schedule --time 09:00   # daily at 09:00
  python scheduler.py --schedule --interval 6   # every 6 hours
  python scheduler.py --hs 03073910 283650      # one-shot, specific codes
  python scheduler.py --sources comtrade wits   # one-shot, specific sources
""",
    )

    # ── Schedule control ──────────────────────────────────────────────────────
    parser.add_argument(
        "--schedule", action="store_true",
        help="Run continuously on a schedule (default: run once and exit)",
    )
    parser.add_argument(
        "--interval", type=int, default=24,
        metavar="HOURS",
        help="Hours between scheduled runs (default: 24). "
             "Used only with --schedule.",
    )
    parser.add_argument(
        "--time", default="06:00",
        metavar="HH:MM",
        help="Daily run time in 24-hour HH:MM format (default: 06:00). "
             "Used when --interval is 24.",
    )

    # ── Scraper pass-through flags ────────────────────────────────────────────
    parser.add_argument(
        "--years", nargs="+", type=int,
        metavar="YEAR",
        help="Years to query, e.g. --years 2022 2023 2024",
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
        help="Data sources to run (default: all)",
    )

    args  = parser.parse_args()
    kwargs = {
        "years":     args.years,
        "sources":   args.sources,
        "hs_filter": args.hs,
    }

    if not args.schedule:
        # ── One-shot mode ─────────────────────────────────────────────────────
        log.info("Running one-shot scrape…")
        _job(**kwargs)
        return

    # ── Continuous schedule mode ──────────────────────────────────────────────
    if args.interval == 24:
        log.info(f"Scheduling daily run at {args.time}…")
        schedule.every().day.at(args.time).do(_job, **kwargs)
    else:
        log.info(f"Scheduling run every {args.interval} hour(s)…")
        schedule.every(args.interval).hours.do(_job, **kwargs)

    # Run immediately on startup so we don't wait a full interval
    log.info("Running initial scrape now…")
    _job(**kwargs)

    log.info("Scheduler active.  Press Ctrl+C to stop.")
    try:
        while True:
            schedule.run_pending()
            time.sleep(60)   # check every minute
    except KeyboardInterrupt:
        log.info("Scheduler stopped by user.")


if __name__ == "__main__":
    main()
