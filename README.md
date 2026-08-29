# DevPak E-Folio

Portfolio site for **Bilal Qayyum** — Data, Business & Systems Analyst.

Live at [devpak.ovh](https://devpak.ovh)

## Projects showcased

- **SafarWise** — AI-powered visa platform ([safarwise.app](https://safarwise.app))
- **Kababish Restaurant** — Production Android ordering app ([Play Store](https://play.google.com/store/apps/details?id=com.kababish.restaurant))
- **Pakistan Aviation Analytics** — BI dashboard over 20 years of CAA traffic data

## Stack

- Astro 5 + React islands + Tailwind CSS
- Recharts + DuckDB-WASM for aviation dashboard
- Python ETL with data validation gate
- Cloudflare Pages deployment

## Local development

```bash
npm install
npm run dev
```

## Aviation data pipeline

```bash
pip install -r scripts/requirements.txt
python scripts/etl_aviation.py      # reads local Excel via AVIATION_DATA_PATH
python scripts/validate_aviation_data.py
```

Set `AVIATION_DATA_PATH` to your local Excel file if not at the default path.

## Resume

Drop your resume at `public/assets/resume.pdf` — the download button activates automatically.

## Deploy

Push to `main` → GitHub Actions validates data + builds → deploy `dist/` to Cloudflare Pages.
