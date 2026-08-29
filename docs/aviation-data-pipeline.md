# Pakistan CAA Aviation Data — Pipeline & Context Reference

Use this document as **portable context** when reusing the same source Excel file in another project (e.g. SafarWise). It describes the raw source, every transform, validation gate, output artifacts, and dashboard conventions applied in the e-folio analytics work.

---

## 1. Source

| Field | Value |
|-------|-------|
| **Authority** | Pakistan Civil Aviation Authority (CAA) — government traffic statistics |
| **Default file** | `Traffic Data 2006-26.xlsx` |
| **Local path (dev)** | `D:\Pakistan Aviation Data\GOV Data\Traffic Data 2006-26.xlsx` |
| **Override** | Set env var `AVIATION_DATA_PATH` to point at any copy of the workbook |
| **Coverage** | July 2006 – June 2026 (partial at both ends) |
| **Sensitivity** | Public government stats; no PII |

### Excel sheets

| Sheet | Rows (approx.) | Purpose |
|-------|----------------|---------|
| `International ARR-DEP Final` | 132,208 data rows | International traffic with arrival/departure direction |
| `Total Domestic Final` | 41,637 data rows | Domestic point-to-point legs |

**Combined row count after ETL:** 173,845

---

## 2. Raw column mapping

### International (`INT_COLS`)

```
month, year, airline, dep_code, dep_airport, arr_code, arr_airport,
passengers, cargo_tons, mail_tons, direction
```

### Domestic (`DOM_COLS`)

Same as international **without** `direction` (column absent in source).

### Derived columns (added in ETL)

| Column | International | Domestic |
|--------|---------------|----------|
| `segment` | `"international"` | `"domestic"` |
| `pk_airport` | `arr_airport` if `direction == "Arr"`, else `dep_airport` | `dep_airport` |
| `pk_code` | `arr_code` if Arr, else `dep_code` | `dep_code` |
| `direction` | `Arr` / `Dep` from source | `""` (empty) |

**Direction semantics (international only):**

- `Arr` — flight **arriving** in Pakistan → Pakistani airport is `arr_airport`
- `Dep` — flight **departing** Pakistan → Pakistani airport is `dep_airport`

Use `pk_airport` / `pk_code` for any “traffic at a Pakistani airport” aggregation on international data.

---

## 3. Cleaning & normalization

### Text (`clean_text`)

- Strip whitespace, collapse internal spaces, trim trailing commas.

### Airlines (`title_case_airline`)

- Title-case after cleaning (e.g. `PIA` → `Pia` becomes `Pia` from `.title()` — source names normalized consistently).

### Airports (`normalize_airport`)

1. **Islamabad merge** — any name matching `ISLAMABAD`, `BBIAP`, `CHAKLALA`, or `IIAP` → **`Islamabad`**
   - BBIAP/Chaklala and the new Islamabad International (IIAP, opened 2018) are one entity in all outputs.
   - Dashboard footnote: *“Islamabad merges BBIAP/Chaklala + IIAP (2018 relocation)”*

2. Strip suffix noise: ` JIAP`, ` AIIAP`, ` BKIAP`, ` INT,L`, ` INTERNATIONAL`

3. Title-case the result.

### Numeric columns

- `passengers`, `cargo_tons`, `mail_tons` → `pd.to_numeric(..., errors="coerce").fillna(0)`
- Negative values must not appear in final parquet (validated).

### Airport codes

- `dep_code`, `arr_code` → uppercase after clean.

### Raw name preservation

- `{col}_raw` columns kept during load for audit (not exported to parquet).

---

## 4. Aggregation rules

### Passenger convention

**Passenger counts = directional flight-leg movements** per CAA reporting. They are **not** unique travelers. One round trip can count as two legs.

### “Flights” in rankings

In entity rankings, `flights` = **row count** (`passengers.count()` per group), i.e. number of reported legs in that bucket — not IFR movements from a separate field.

### International airport traffic

Group by `pk_airport` (direction-aware Pakistani endpoint).

### Domestic airport traffic

Sum **both** endpoints per airport:

```python
dep_pax = groupby("dep_airport")
arr_pax = groupby("arr_airport")
total  = dep_pax.add(arr_pax, fill_value=0).groupby(level=0).sum()
```

Same pattern for `cargo_tons` where applicable.

### Partial years

| Year | Months in data | Flag |
|------|----------------|------|
| **2006** | 7–12 only (H2) | `partial_year: true`, `months_covered: 6` |
| **2026** | 1–6 only (H1 YTD) | `partial_year: true`, `months_covered: 6` |
| All others | 12 | `partial_year: false` |

Heatmap / UI: cells for Jan–Jun 2006 and Jul–Dec 2026 are styled as partial (dashed border).

### Inactive airlines (`airline-metadata.json`)

Marked `inactive: true` if:

1. Name matches any of: `SHAHEEN`, `SERENE`, `AERO ASIA`, `BHoja`, `AIR INDUS`, `RAYA`, `SAFE AIR`, `SAHARA`, `TABA`, `ORIENT`, `CAMBATA`, **or**
2. `last_year < 2023` (no data in recent years)

Used for “Inactive” badges in charts only — rows are **not** removed from data.

### CAGR (dashboard)

For each airline, within a selected year window:

1. Collect years with data in range.
2. Require ≥ 2 distinct years and `startPax >= 100`.
3. CAGR = `(end/start)^(1/span) - 1` where `span = endYear - startYear` (calendar span, not count of non-null years).
4. Gaps in intermediate years do **not** exclude the airline; endpoints only.
5. Notes appended when data starts after range start, ends before range end, or has internal gaps.

---

## 5. Validated totals (quality gate)

These are the **canonical checksums**. ETL `manifest.json` and `validate_aviation_data.py` must match exactly.

| Metric | International | Domestic |
|--------|---------------|----------|
| **Rows** | 132,208 | 41,637 |
| **Passengers** | 236,427,307 | 63,247,460 |
| **Cargo (metric tons)** | 4,911,017.36 | 499,251.89 |

**Combined passengers:** 299,674,767  
**Combined rows:** 173,845

Cargo tolerance in validator: ±1.0 ton.

### Validation script checks

`scripts/validate_aviation_data.py`:

1. `manifest.json` row counts and totals vs table above
2. Parquet: no negative `passengers` or `cargo_tons`
3. `yearly-trends.json`: years 2006 and 2026 must have `months_covered == 6`

CI runs this on every push/PR (see `.github/workflows/deploy.yml`).

---

## 6. Pipeline commands

```bash
# Install Python deps (from repo root)
pip install -r scripts/requirements.txt

# Run ETL (reads AVIATION_DATA_PATH or default Windows path)
python scripts/etl_aviation.py

# Validate outputs
python scripts/validate_aviation_data.py

# Build site (separate)
npm ci && npm run build
```

**Outputs directory:** `public/data/aviation/`

After refresh, commit updated JSON + `traffic.parquet` + `manifest.json`.

---

## 7. Output artifacts

### Core analytical table

| File | Format | Description |
|------|--------|-------------|
| `traffic.parquet` | ZSTD Parquet | Full cleaned leg-level table (173,845 rows) |

**Parquet columns:**

```
month, year, airline, dep_code, dep_airport, arr_code, arr_airport,
passengers, cargo_tons, mail_tons, direction, segment, pk_airport, pk_code
```

### Summary & metadata

| File | Purpose |
|------|---------|
| `summary.json` | Segment totals, row counts, year range |
| `manifest.json` | Row counts + totals for validation |
| `metadata.json` | Source attribution, methodology, partial-year notes |
| `data_dictionary.json` | Direction codes, passenger convention, Islamabad merge |

### Pre-aggregated JSON (for static dashboard / no-SQL mode)

| File | Structure | Use |
|------|-----------|-----|
| `yearly-trends.json` | `[{year, segment, passengers, cargo_tons, months_covered, partial_year}]` | Year-over-year lines, KPIs |
| `monthly-seasonality.json` | `[{year, month, segment, passengers, cargo_tons}]` | Heatmap, monthly cargo views |
| `yearly-top-entities.json` | `{airlines, airports} → segment → year → [{name, passengers, cargo_tons, flights}]` | Single-year rankings |
| `period-entity-rankings.json` | `{airlines, airports} → segment → "YYYY-M" → entity rows` | Month/year slicers (~2MB) |
| `airline-yearly-passengers.json` | `{international, domestic} → [{year, airline, passengers}]` | CAGR, compare-over-time |
| `monthly-airline-breakdown.json` | `[{year, month, segment, passengers, top_airlines[]}]` | Heatmap tooltips (`segment` includes `"all"`) |
| `airline-metadata.json` | `{airlines: [{airline, first_year, last_year, years_active, inactive}]}` | Inactive badges |
| `airline-rankings.json` | All-time top 25 by pax/cargo per segment | Legacy summary |
| `airport-traffic.json` | Top 20 airports per segment | Legacy summary |
| `route-highlights.json` | Top 15 routes per segment | Optional insights |
| `insights.json` | Narrative findings + `carriers_per_year` | Dashboard copy |

### Period ranking JSON key format

`period-entity-rankings.json` buckets: `"YYYY-M"` where `M` is 1–12 (no zero-padding required in key but ETL uses `f"{year}-{month}"`).

To aggregate **all months in one year** from period file: sum all keys matching `"{year}-*"`.

To aggregate **one month across all years**: sum all keys matching `"*-{month}"`.

---

## 8. DuckDB-WASM (live queries in browser)

The e-folio dashboard loads `traffic.parquet` client-side:

```sql
CREATE TABLE traffic AS SELECT * FROM read_parquet('traffic.parquet');
```

### Example period filter (SQL)

```sql
-- All data
WHERE 1=1

-- Single year, all months
WHERE year = 2019

-- Single year + month
WHERE year = 2019 AND month = 3

-- One month across all years
WHERE month = 3
```

### Example entity ranking query

```sql
SELECT airline,
       SUM(passengers) AS passengers,
       SUM(cargo_tons) AS cargo_tons,
       COUNT(*) AS flights
FROM traffic
WHERE year = 2019 AND segment = 'international'
GROUP BY 1
ORDER BY passengers DESC;
```

### Airport column choice

| Segment | Airport column for GROUP BY |
|---------|----------------------------|
| International | `pk_airport` |
| Domestic | Merge `dep_airport` + `arr_airport` (see §4) |
| All (intl side) | `pk_airport` with optional `segment` filter |

---

## 9. ETL implementation map

| Logic | Python function | Output file |
|-------|-----------------|-------------|
| Load intl/dom | `load_international`, `load_domestic` | (in-memory) |
| Yearly totals | `yearly_trends` | `yearly-trends.json` |
| Airline rankings | `airline_rankings` | `airline-rankings.json` |
| Airport rankings | `airport_traffic` | `airport-traffic.json` |
| Routes | `route_highlights` | `route-highlights.json` |
| Monthly grid | `monthly_seasonality` | `monthly-seasonality.json` |
| Per-year tops | `yearly_top_entities` | `yearly-top-entities.json` |
| Per month-year tops | `period_entity_rankings` | `period-entity-rankings.json` |
| Airline × year | `airline_yearly_passengers` | `airline-yearly-passengers.json` |
| Heatmap tooltips | `monthly_airline_breakdown` | `monthly-airline-breakdown.json` |
| Airline status | `airline_metadata` | `airline-metadata.json` |
| Insights | inline in `main()` | `insights.json` |
| Full export | `combined[export_cols].to_parquet` | `traffic.parquet` |

Source: `scripts/etl_aviation.py`  
Validator: `scripts/validate_aviation_data.py`

---

## 10. SafarWise reuse checklist

When pointing a new app at the **same Excel file**:

1. **Set `AVIATION_DATA_PATH`** to the workbook path (or copy `etl_aviation.py` and change `DEFAULT_INPUT`).
2. **Run ETL + validate** — do not skip validation; totals are the regression test.
3. **Respect `pk_airport`** for international airport metrics — do not always use `dep_airport`.
4. **Merge Islamabad** before any airport-level join or display.
5. **Label partial years** in UI (2006 H2, 2026 H1).
6. **Treat passengers as leg counts**, not unique pax.
7. **Prefer `traffic.parquet`** for ad-hoc SQL; use pre-aggregated JSON for static/mobile if WASM is too heavy.
8. **CAGR** — use endpoint years only; document gaps in UI if showing growth rates.
9. **Inactive airlines** — use `airline-metadata.json` or replicate `INACTIVE_PATTERNS` + `last_year < 2023` rule.

### Minimal files to ship with a new project

If token budget is tight, attach at minimum:

- `traffic.parquet`
- `manifest.json` (for checksums)
- `data_dictionary.json`
- `metadata.json`
- This file (`docs/aviation-data-pipeline.md`)

Add `period-entity-rankings.json` + `airline-yearly-passengers.json` if the app needs period slicers or CAGR without DuckDB.

---

## 11. Related repo files

| Path | Role |
|------|------|
| `scripts/etl_aviation.py` | Full ETL |
| `scripts/validate_aviation_data.py` | CI quality gate |
| `scripts/requirements.txt` | pandas, openpyxl, pyarrow |
| `public/data/aviation/*` | Generated artifacts |
| `src/components/dashboard/AviationDashboard.tsx` | Reference dashboard implementation |
| `data-source.md` | Short attribution blurb |
| `.github/workflows/deploy.yml` | Validates data before build |

---

*Generated for cross-project context. Last aligned with e-folio commit implementing unified period filters and DuckDB live rankings (Aug 2026).*
