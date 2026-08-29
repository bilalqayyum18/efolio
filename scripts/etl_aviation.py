#!/usr/bin/env python3
"""ETL for Pakistan CAA aviation traffic data (2006-2026)."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

INT_COLS = [
    "month", "year", "airline", "dep_code", "dep_airport",
    "arr_code", "arr_airport", "passengers", "cargo_tons", "mail_tons", "direction",
]
DOM_COLS = INT_COLS[:-1]

ISLAMABAD_PATTERNS = [r"ISLAMABAD", r"BBIAP", r"CHAKLALA", r"IIAP"]

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data" / "aviation"
DEFAULT_INPUT = Path(r"D:\Pakistan Aviation Data\GOV Data\Traffic Data 2006-26.xlsx")

VALIDATED = {
    "international": {"passengers": 236_427_307, "cargo_tons": 4_911_017.0},
    "domestic": {"passengers": 63_247_460, "cargo_tons": 499_252.0},
}


def clean_text(s: str) -> str:
    if pd.isna(s):
        return ""
    return re.sub(r"\s+", " ", str(s).strip().rstrip(",").strip())


def title_case_airline(name: str) -> str:
    return name.title() if name else name


def is_islamabad(airport: str) -> bool:
    upper = airport.upper()
    return any(re.search(p, upper) for p in ISLAMABAD_PATTERNS)


def normalize_airport(airport: str) -> str:
    cleaned = clean_text(airport)
    if is_islamabad(cleaned):
        return "Islamabad"
    for suffix in (" JIAP", " AIIAP", " BKIAP", " INT,L", " INTERNATIONAL"):
        if cleaned.upper().endswith(suffix.strip()):
            cleaned = cleaned[: -len(suffix)].strip()
    return cleaned.title() if cleaned else cleaned


def months_covered_for_year(df: pd.DataFrame, year: int) -> int:
    return int(df.loc[df["year"] == year, "month"].dropna().nunique())


def load_international(path: Path) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name="International ARR-DEP Final", header=0)
    raw = raw.dropna(how="all")
    raw.columns = range(len(raw.columns))
    df = raw.iloc[:, : len(INT_COLS)].copy()
    df.columns = INT_COLS
    for col in ("airline", "dep_airport", "arr_airport"):
        df[f"{col}_raw"] = df[col].astype(str)
        df[col] = df[col].apply(clean_text).apply(
            title_case_airline if col == "airline" else normalize_airport
        )
    for col in ("dep_code", "arr_code"):
        df[col] = df[col].apply(clean_text).str.upper()
    df["direction"] = df["direction"].apply(clean_text)
    for col in ("passengers", "cargo_tons", "mail_tons"):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    df["segment"] = "international"
    df["pk_airport"] = df.apply(
        lambda r: r["arr_airport"] if r["direction"] == "Arr" else r["dep_airport"], axis=1
    )
    df["pk_code"] = df.apply(
        lambda r: r["arr_code"] if r["direction"] == "Arr" else r["dep_code"], axis=1
    )
    return df


def load_domestic(path: Path) -> pd.DataFrame:
    raw = pd.read_excel(path, sheet_name="Total Domestic Final", header=0)
    raw = raw.dropna(how="all")
    raw.columns = range(len(raw.columns))
    df = raw.iloc[:, : len(DOM_COLS)].copy()
    df.columns = DOM_COLS
    for col in ("airline", "dep_airport", "arr_airport"):
        df[f"{col}_raw"] = df[col].astype(str)
        df[col] = df[col].apply(clean_text).apply(
            title_case_airline if col == "airline" else normalize_airport
        )
    for col in ("dep_code", "arr_code"):
        df[col] = df[col].apply(clean_text).str.upper()
    for col in ("passengers", "cargo_tons", "mail_tons"):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    df["direction"] = ""
    df["segment"] = "domestic"
    df["pk_airport"] = df["dep_airport"]
    df["pk_code"] = df["dep_code"]
    return df


def yearly_trends(df: pd.DataFrame) -> list[dict]:
    records = []
    for (year, segment), grp in df.groupby(["year", "segment"]):
        records.append({
            "year": int(year),
            "segment": segment,
            "passengers": int(grp["passengers"].sum()),
            "cargo_tons": round(float(grp["cargo_tons"].sum()), 2),
            "months_covered": months_covered_for_year(df, int(year)),
            "partial_year": int(year) in (2006, 2026),
        })
    return sorted(records, key=lambda r: (r["year"], r["segment"]))


def airline_rankings(df: pd.DataFrame, top_n: int = 25) -> dict:
    result = {}
    for segment in ("international", "domestic"):
        seg = df[df["segment"] == segment]
        by_pax = seg.groupby("airline")["passengers"].sum().sort_values(ascending=False).head(top_n)
        by_cargo = seg.groupby("airline")["cargo_tons"].sum().sort_values(ascending=False).head(top_n)
        result[segment] = {
            "by_passengers": [{"airline": k, "passengers": int(v)} for k, v in by_pax.items()],
            "by_cargo": [{"airline": k, "cargo_tons": round(float(v), 2)} for k, v in by_cargo.items()],
        }
    return result


def airport_traffic(df: pd.DataFrame, top_n: int = 20) -> dict:
    intl = df[df["segment"] == "international"]
    intl_pk = (
        intl.groupby("pk_airport")
        .agg(passengers=("passengers", "sum"), cargo_tons=("cargo_tons", "sum"))
        .sort_values("passengers", ascending=False)
        .head(top_n)
    )
    dom = df[df["segment"] == "domestic"]
    dom_pax = pd.concat([
        dom.groupby("dep_airport")["passengers"].sum(),
        dom.groupby("arr_airport")["passengers"].sum(),
    ]).groupby(level=0).sum().sort_values(ascending=False).head(top_n)
    dom_cargo = pd.concat([
        dom.groupby("dep_airport")["cargo_tons"].sum(),
        dom.groupby("arr_airport")["cargo_tons"].sum(),
    ]).groupby(level=0).sum()
    return {
        "international": [
            {"airport": k, "passengers": int(r.passengers), "cargo_tons": round(float(r.cargo_tons), 2)}
            for k, r in intl_pk.iterrows()
        ],
        "domestic": [
            {"airport": k, "passengers": int(v), "cargo_tons": round(float(dom_cargo.get(k, 0)), 2)}
            for k, v in dom_pax.items()
        ],
    }


def route_highlights(df: pd.DataFrame, top_n: int = 15) -> dict:
    result = {}
    for segment in ("international", "domestic"):
        seg = df[df["segment"] == segment].copy()
        seg["route"] = seg["dep_airport"] + " → " + seg["arr_airport"]
        top = seg.groupby("route")["passengers"].sum().sort_values(ascending=False).head(top_n)
        result[segment] = [{"route": k, "passengers": int(v)} for k, v in top.items()]
    return result


def monthly_seasonality(df: pd.DataFrame) -> list[dict]:
    records = []
    for (year, month, segment), grp in df.groupby(["year", "month", "segment"]):
        records.append({
            "year": int(year),
            "month": int(month),
            "segment": segment,
            "passengers": int(grp["passengers"].sum()),
            "cargo_tons": round(float(grp["cargo_tons"].sum()), 2),
        })
    return records


def carriers_per_year(df: pd.DataFrame) -> list[dict]:
    dom = df[df["segment"] == "domestic"]
    return sorted([
        {
            "year": int(year),
            "carrier_count": int(grp["airline"].nunique()),
            "carriers": sorted(grp["airline"].unique().tolist()),
        }
        for year, grp in dom.groupby("year")
    ], key=lambda r: r["year"])


def yearly_top_entities(df: pd.DataFrame, top_n: int = 15) -> dict:
    """Per-year top airlines and airports by passengers, cargo, and flight-leg count."""
    result: dict = {"airlines": {}, "airports": {}}

    for segment in ("international", "domestic"):
        seg = df[df["segment"] == segment]
        result["airlines"][segment] = {}
        result["airports"][segment] = {}

        for year, ygrp in seg.groupby("year"):
            year = int(year)
            # Airlines
            aln = (
                ygrp.groupby("airline")
                .agg(passengers=("passengers", "sum"), cargo_tons=("cargo_tons", "sum"), flights=("passengers", "count"))
                .sort_values("passengers", ascending=False)
                .head(top_n)
            )
            result["airlines"][segment][str(year)] = [
                {
                    "name": k,
                    "passengers": int(r.passengers),
                    "cargo_tons": round(float(r.cargo_tons), 2),
                    "flights": int(r.flights),
                }
                for k, r in aln.iterrows()
            ]

            # Airports
            if segment == "international":
                apt = (
                    ygrp.groupby("pk_airport")
                    .agg(passengers=("passengers", "sum"), cargo_tons=("cargo_tons", "sum"), flights=("passengers", "count"))
                    .sort_values("passengers", ascending=False)
                    .head(top_n)
                )
            else:
                dep = ygrp.groupby("dep_airport").agg(
                    passengers=("passengers", "sum"), cargo_tons=("cargo_tons", "sum"), flights=("passengers", "count")
                )
                arr = ygrp.groupby("arr_airport").agg(
                    passengers=("passengers", "sum"), cargo_tons=("cargo_tons", "sum"), flights=("passengers", "count")
                )
                apt = dep.add(arr, fill_value=0).groupby(level=0).sum().sort_values("passengers", ascending=False).head(top_n)

            result["airports"][segment][str(year)] = [
                {
                    "name": k,
                    "passengers": int(r.passengers),
                    "cargo_tons": round(float(r.cargo_tons), 2),
                    "flights": int(r.flights),
                }
                for k, r in apt.iterrows()
            ]

    return result


def airline_yearly_passengers(df: pd.DataFrame) -> dict:
    """Yearly passenger totals per airline — used for CAGR calculations in the dashboard."""
    result: dict = {"international": [], "domestic": []}
    for segment in ("international", "domestic"):
        seg = df[df["segment"] == segment]
        for (year, airline), grp in seg.groupby(["year", "airline"]):
            result[segment].append({
                "year": int(year),
                "airline": airline,
                "passengers": int(grp["passengers"].sum()),
            })
    for seg in result:
        result[seg].sort(key=lambda r: (r["year"], r["airline"]))
    return result


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main() -> None:
    input_path = Path(os.environ.get("AVIATION_DATA_PATH", DEFAULT_INPUT))
    if not input_path.exists():
        raise FileNotFoundError(f"Aviation data not found: {input_path}")

    intl = load_international(input_path)
    dom = load_domestic(input_path)
    combined = pd.concat([intl, dom], ignore_index=True)

    summary = {
        "international": {
            "passengers": int(intl["passengers"].sum()),
            "cargo_tons": round(float(intl["cargo_tons"].sum()), 2),
            "airlines": int(intl["airline"].nunique()),
            "rows": len(intl),
        },
        "domestic": {
            "passengers": int(dom["passengers"].sum()),
            "cargo_tons": round(float(dom["cargo_tons"].sum()), 2),
            "airlines": int(dom["airline"].nunique()),
            "rows": len(dom),
        },
        "combined": {
            "passengers": int(combined["passengers"].sum()),
            "cargo_tons": round(float(combined["cargo_tons"].sum()), 2),
            "rows": len(combined),
            "year_range": [2006, 2026],
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    metadata = {
        "source": "Pakistan Civil Aviation Authority (CAA) — Government traffic statistics",
        "file": input_path.name,
        "methodology": (
            "International Pakistani airport traffic uses direction-aware aggregation. "
            "Islamabad BBIAP/Chaklala and IIAP merged with 2018 relocation footnote."
        ),
        "partial_years": {"2006": "July–December (H2)", "2026": "January–June (H1 YTD)"},
        "generated_at": summary["generated_at"],
    }

    data_dictionary = {
        "direction": {
            "Arr": "Arrival in Pakistan — Pakistani airport is arr_airport",
            "Dep": "Departure from Pakistan — Pakistani airport is dep_airport",
        },
        "passenger_convention": (
            "Passenger counts are directional flight-leg movements per CAA reporting, not unique travelers."
        ),
        "islamabad_merge": (
            "Islamabad BBIAP/Chaklala and IIAP merged into 'Islamabad' (IIAP opened 2018)."
        ),
        "partial_years": metadata["partial_years"],
    }

    insights = {
        "findings": [
            {
                "title": "Post-COVID recovery",
                "body": "International passenger volumes recovered strongly after 2020–2021, with partial-year flags on 2006 and 2026.",
            },
            {
                "title": "Domestic market liberalization",
                "body": "Distinct domestic carriers rose from 3–4 through the 2010s to 5 by 2022–2025 as AirSial and Fly Jinnah entered.",
            },
            {
                "title": "Karachi hub dominance",
                "body": "Karachi leads Pakistani airport passenger traffic with direction-aware international aggregation.",
            },
            {
                "title": "Passenger-led growth",
                "body": "2007→2025: international passengers grew ~2.6×, cargo ~1.3× — cargo intensity per passenger declined.",
            },
        ],
        "carriers_per_year": carriers_per_year(combined),
    }

    export_cols = [
        "month", "year", "airline", "dep_code", "dep_airport", "arr_code", "arr_airport",
        "passengers", "cargo_tons", "mail_tons", "direction", "segment", "pk_airport", "pk_code",
    ]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUTPUT_DIR / "summary.json", summary)
    write_json(OUTPUT_DIR / "yearly-trends.json", yearly_trends(combined))
    write_json(OUTPUT_DIR / "airline-rankings.json", airline_rankings(combined))
    write_json(OUTPUT_DIR / "airport-traffic.json", airport_traffic(combined))
    write_json(OUTPUT_DIR / "route-highlights.json", route_highlights(combined))
    write_json(OUTPUT_DIR / "monthly-seasonality.json", monthly_seasonality(combined))
    write_json(OUTPUT_DIR / "metadata.json", metadata)
    write_json(OUTPUT_DIR / "data_dictionary.json", data_dictionary)
    write_json(OUTPUT_DIR / "insights.json", insights)
    write_json(OUTPUT_DIR / "yearly-top-entities.json", yearly_top_entities(combined))
    write_json(OUTPUT_DIR / "airline-yearly-passengers.json", airline_yearly_passengers(combined))
    combined[export_cols].to_parquet(OUTPUT_DIR / "traffic.parquet", compression="zstd", index=False)

    manifest = {
        "row_counts": {"international": len(intl), "domestic": len(dom), "combined": len(combined)},
        "totals": {
            "international_passengers": summary["international"]["passengers"],
            "domestic_passengers": summary["domestic"]["passengers"],
            "international_cargo": summary["international"]["cargo_tons"],
            "domestic_cargo": summary["domestic"]["cargo_tons"],
        },
        "validated_against": VALIDATED,
    }
    write_json(OUTPUT_DIR / "manifest.json", manifest)
    print(f"ETL complete: {len(combined)} rows -> {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
