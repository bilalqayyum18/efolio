#!/usr/bin/env python3
"""Data quality gate for aviation ETL outputs."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "public" / "data" / "aviation"

EXPECTED = {
    "international_rows": 132_208,  # 132209 sheet rows minus 1 blank
    "domestic_rows": 41_637,
    "combined_rows": 173_845,
    "international_passengers": 236_427_307,
    "domestic_passengers": 63_247_460,
    "international_cargo": 4_911_017.0,
    "domestic_cargo": 499_252.0,
}
TOLERANCE = 1.0


def fail(msg: str) -> None:
    print(f"VALIDATION FAILED: {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    manifest_path = DATA_DIR / "manifest.json"
    parquet_path = DATA_DIR / "traffic.parquet"

    if not manifest_path.exists():
        fail(f"Missing manifest: {manifest_path}. Run etl_aviation.py first.")

    with manifest_path.open(encoding="utf-8") as f:
        manifest = json.load(f)

    rows = manifest["row_counts"]
    if rows["international"] != EXPECTED["international_rows"]:
        fail(f"International row count {rows['international']} != {EXPECTED['international_rows']}")
    if rows["domestic"] != EXPECTED["domestic_rows"]:
        fail(f"Domestic row count {rows['domestic']} != {EXPECTED['domestic_rows']}")
    if rows["combined"] != EXPECTED["combined_rows"]:
        fail(f"Combined row count {rows['combined']} != {EXPECTED['combined_rows']}")

    totals = manifest["totals"]
    if totals["international_passengers"] != EXPECTED["international_passengers"]:
        fail("International passenger total mismatch")
    if totals["domestic_passengers"] != EXPECTED["domestic_passengers"]:
        fail("Domestic passenger total mismatch")
    if abs(totals["international_cargo"] - EXPECTED["international_cargo"]) > TOLERANCE:
        fail("International cargo total mismatch")
    if abs(totals["domestic_cargo"] - EXPECTED["domestic_cargo"]) > TOLERANCE:
        fail("Domestic cargo total mismatch")

    if parquet_path.exists():
        df = pd.read_parquet(parquet_path)
        if (df["passengers"] < 0).any():
            fail("Negative passenger values found")
        if (df["cargo_tons"] < 0).any():
            fail("Negative cargo values found")

    trends_path = DATA_DIR / "yearly-trends.json"
    if trends_path.exists():
        with trends_path.open(encoding="utf-8") as f:
            trends = json.load(f)
        for rec in [t for t in trends if t["year"] in (2006, 2026)]:
            if rec["months_covered"] != 6:
                fail(f"Year {rec['year']} should have months_covered=6")

    print("VALIDATION PASSED")


if __name__ == "__main__":
    main()
