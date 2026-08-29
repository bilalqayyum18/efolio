# Pakistan Aviation Data — Source Attribution

**Source:** Pakistan Civil Aviation Authority (CAA) — Government traffic statistics  
**Period:** July 2006 – June 2026  
**Sheets:** International ARR-DEP Final, Total Domestic Final

This is publicly available government statistical data. No personal or commercially sensitive information is included.

## Methodology

- International Pakistani airport traffic uses direction-aware aggregation (`Arr` → arrival airport, `Dep` → departure airport)
- Islamabad BBIAP/Chaklala and IIAP merged into single "Islamabad" entity (IIAP opened 2018)
- Passenger counts represent directional flight-leg movements per CAA reporting convention
- Partial years: 2006 (H2 only), 2026 (H1 YTD)

## Refresh

When new CAA data is published, re-run `scripts/etl_aviation.py` and commit updated files in `public/data/aviation/`.
