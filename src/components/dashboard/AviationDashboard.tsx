import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type Summary = {
  international: { passengers: number; cargo_tons: number };
  domestic: { passengers: number; cargo_tons: number };
  combined: { passengers: number; cargo_tons: number; year_range: number[] };
};

type YearlyTrend = {
  year: number;
  segment: string;
  passengers: number;
  cargo_tons: number;
  months_covered: number;
  partial_year: boolean;
};

type AirportRow = { airport: string; passengers: number; cargo_tons: number };
type AirlineRow = { airline: string; passengers: number };
type SeasonalityRow = { year: number; month: number; segment: string; passengers: number };
type Insight = { title: string; body: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHART_COLORS = { intl: "#4a90d9", dom: "#3ddc84", cargo: "#f5a623" };

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function Heatmap({ data, segment }: { data: SeasonalityRow[]; segment: string }) {
  const filtered = data.filter((d) => d.segment === segment);
  const years = [...new Set(filtered.map((d) => d.year))].sort();
  const maxPax = Math.max(...filtered.map((d) => d.passengers), 1);

  const getCell = (year: number, month: number) =>
    filtered.find((d) => d.year === year && d.month === month)?.passengers ?? 0;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="mb-2 flex gap-1 pl-12">
          {MONTHS.map((m) => (
            <div key={m} className="flex-1 text-center font-data text-[10px] text-strip-muted">{m}</div>
          ))}
        </div>
        {years.map((year) => (
          <div key={year} className="mb-0.5 flex items-center gap-1">
            <div className="w-10 shrink-0 font-data text-[10px] text-strip-muted">
              {year}{(year === 2006 || year === 2026) ? "*" : ""}
            </div>
            {MONTHS.map((_, mi) => {
              const val = getCell(year, mi + 1);
              const intensity = val / maxPax;
              const isPartial = (year === 2006 && mi < 6) || (year === 2026 && mi >= 6);
              return (
                <div
                  key={mi}
                  title={`${year}-${String(mi + 1).padStart(2, "0")}: ${val.toLocaleString()} pax`}
                  className="flex-1 aspect-square rounded-sm"
                  style={{
                    backgroundColor: isPartial
                      ? "rgba(90,109,138,0.2)"
                      : `rgba(74,144,217,${0.1 + intensity * 0.9})`,
                    border: isPartial ? "1px dashed rgba(90,109,138,0.4)" : "none",
                  }}
                />
              );
            })}
          </div>
        ))}
        <p className="mt-2 font-data text-[10px] text-strip-partial">* Partial year: H2 2006 / H1 2026 (YTD)</p>
      </div>
    </div>
  );
}

function RankingTable({ rows, labelKey }: { rows: AirportRow[] | AirlineRow[]; labelKey: string }) {
  const max = Math.max(...rows.map((r) => r.passengers), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full font-data text-sm">
        <thead>
          <tr className="border-b border-strip-border text-left text-xs uppercase tracking-wider text-strip-muted">
            <th className="pb-2 pr-4">#</th>
            <th className="pb-2 pr-4">{labelKey}</th>
            <th className="pb-2">Passengers</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const label = labelKey === "Airport" ? (row as AirportRow).airport : (row as AirlineRow).airline;
            return (
              <tr key={label} className="border-b border-strip-border/50">
                <td className="py-2 pr-4 text-strip-muted">{i + 1}</td>
                <td className="py-2 pr-4">{label}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 max-w-[120px] rounded bg-strip-border">
                      <div className="h-full rounded bg-strip-accent" style={{ width: `${(row.passengers / max) * 100}%` }} />
                    </div>
                    <span className="text-strip-muted">{formatNum(row.passengers)}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AviationDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<YearlyTrend[]>([]);
  const [seasonality, setSeasonality] = useState<SeasonalityRow[]>([]);
  const [airports, setAirports] = useState<{ international: AirportRow[]; domestic: AirportRow[] } | null>(null);
  const [airlines, setAirlines] = useState<AirlineRow[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [segment, setSegment] = useState<"all" | "international" | "domestic">("all");
  const [yearRange, setYearRange] = useState<[number, number]>([2007, 2025]);
  const [duckReady, setDuckReady] = useState(false);
  const [duckLoading, setDuckLoading] = useState(false);
  const [duckConn, setDuckConn] = useState<unknown>(null);
  const [filteredKpis, setFilteredKpis] = useState<{ passengers: number; cargo: number } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/data/aviation/summary.json").then((r) => r.json()),
      fetch("/data/aviation/yearly-trends.json").then((r) => r.json()),
      fetch("/data/aviation/monthly-seasonality.json").then((r) => r.json()),
      fetch("/data/aviation/airport-traffic.json").then((r) => r.json()),
      fetch("/data/aviation/airline-rankings.json").then((r) => r.json()),
      fetch("/data/aviation/insights.json").then((r) => r.json()),
    ]).then(([s, t, seas, apt, aln, ins]) => {
      setSummary(s);
      setTrends(t);
      setSeasonality(seas);
      setAirports(apt);
      setAirlines(aln.international.by_passengers.slice(0, 15));
      setInsights(ins.findings);
    });
  }, []);

  const chartData = useMemo(() => {
    const years = [...new Set(trends.map((t) => t.year))].sort();
    return years.map((year) => {
      const intl = trends.find((t) => t.year === year && t.segment === "international");
      const dom = trends.find((t) => t.year === year && t.segment === "domestic");
      return {
        year,
        partial: intl?.partial_year || dom?.partial_year,
        intlPax: intl?.passengers ?? 0,
        domPax: dom?.passengers ?? 0,
        intlCargo: intl?.cargo_tons ?? 0,
        domCargo: dom?.cargo_tons ?? 0,
      };
    }).filter((d) => d.year >= yearRange[0] && d.year <= yearRange[1]);
  }, [trends, yearRange]);

  const initDuckDB = useCallback(async () => {
    if (duckReady || duckLoading) return;
    setDuckLoading(true);
    try {
      const duckdb = await import("@duckdb/duckdb-wasm");
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      const resp = await fetch("/data/aviation/traffic.parquet");
      const buf = new Uint8Array(await resp.arrayBuffer());
      await db.registerFileBuffer("traffic.parquet", buf);
      await conn.query("CREATE TABLE traffic AS SELECT * FROM read_parquet('traffic.parquet')");
      setDuckConn(conn);
      setDuckReady(true);
    } catch (e) {
      console.error("DuckDB init failed:", e);
    } finally {
      setDuckLoading(false);
    }
  }, [duckReady, duckLoading]);

  useEffect(() => {
    const el = document.getElementById("aviation-dashboard");
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) initDuckDB();
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [initDuckDB]);

  useEffect(() => {
    if (!duckConn || !duckReady) return;
    const segFilter = segment === "all" ? "" : `AND segment = '${segment}'`;
    (duckConn as { query: (sql: string) => Promise<{ toArray: () => { passengers: number; cargo_tons: number }[] }> })
      .query(`SELECT SUM(passengers) as passengers, SUM(cargo_tons) as cargo_tons FROM traffic WHERE year BETWEEN ${yearRange[0]} AND ${yearRange[1]} ${segFilter}`)
      .then((r) => {
        const row = r.toArray()[0];
        setFilteredKpis({ passengers: Number(row.passengers), cargo: Number(row.cargo_tons) });
      });
  }, [duckConn, duckReady, segment, yearRange]);

  const exportCsv = async () => {
    if (!duckConn) return;
    const segFilter = segment === "all" ? "" : `AND segment = '${segment}'`;
    const r = await (duckConn as { query: (sql: string) => Promise<{ toArray: () => Record<string, unknown>[] }> })
      .query(`SELECT year, month, airline, segment, passengers, cargo_tons FROM traffic WHERE year BETWEEN ${yearRange[0]} AND ${yearRange[1]} ${segFilter} LIMIT 5000`);
    const rows = r.toArray();
    const header = Object.keys(rows[0] ?? {}).join(",");
    const csv = [header, ...rows.map((row) => Object.values(row).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aviation-export.csv";
    a.click();
  };

  if (!summary) {
    return <div className="strip-card p-8 text-center font-data text-strip-muted">Loading dashboard data...</div>;
  }

  return (
    <div id="aviation-dashboard" className="space-y-8">
      {/* Filter pane */}
      <div className="strip-card">
        <p className="strip-label mb-4">Filters / Slicers</p>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="font-data text-xs text-strip-muted">Segment</label>
            <div className="mt-2 flex gap-2">
              {(["all", "international", "domestic"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSegment(s)}
                  className={`rounded border px-3 py-1 font-data text-xs uppercase ${segment === s ? "border-strip-accent bg-strip-accent/20 text-strip-accent" : "border-strip-border text-strip-muted"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="font-data text-xs text-strip-muted">Year range: {yearRange[0]}–{yearRange[1]}</label>
            <input type="range" min={2006} max={2026} value={yearRange[0]} onChange={(e) => setYearRange([+e.target.value, yearRange[1]])} className="mt-2 w-full" />
            <input type="range" min={2006} max={2026} value={yearRange[1]} onChange={(e) => setYearRange([yearRange[0], +e.target.value])} className="mt-1 w-full" />
          </div>
          <div className="flex items-end gap-2">
            {duckLoading && <span className="font-data text-xs text-strip-muted">Loading SQL engine...</span>}
            {duckReady && <span className="font-data text-xs text-strip-signal">DuckDB ready</span>}
            <button onClick={exportCsv} disabled={!duckReady} className="strip-btn text-xs disabled:opacity-40">Export CSV</button>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Passengers", value: filteredKpis?.passengers ?? summary.combined.passengers },
          { label: "Total Cargo (MT)", value: filteredKpis?.cargo ?? summary.combined.cargo_tons, isCargo: true },
          { label: "International Pax", value: summary.international.passengers },
          { label: "Domestic Pax", value: summary.domestic.passengers },
        ].map((kpi) => (
          <div key={kpi.label} className="strip-card">
            <p className="strip-label">{kpi.label}</p>
            <p className="mt-2 font-data text-2xl font-semibold text-strip-text">
              {kpi.isCargo ? kpi.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : formatNum(kpi.value as number)}
            </p>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <div className="strip-card">
        <p className="strip-label mb-4">Passenger Trends</p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" />
            <XAxis dataKey="year" tick={{ fill: "#8fa3bf", fontSize: 11 }} />
            <YAxis tick={{ fill: "#8fa3bf", fontSize: 11 }} tickFormatter={formatNum} />
            <Tooltip contentStyle={{ background: "#121f38", border: "1px solid #1e3054", fontFamily: "JetBrains Mono" }} />
            <Legend />
            <Line type="monotone" dataKey="intlPax" name="International" stroke={CHART_COLORS.intl} dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="domPax" name="Domestic" stroke={CHART_COLORS.dom} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Heatmap — signature visual */}
      <div className="strip-card">
        <p className="strip-label mb-2">Signature Visual</p>
        <h3 className="font-display text-lg font-bold">Year × Month Passenger Heatmap</h3>
        <div className="mt-6">
          <Heatmap data={seasonality} segment={segment === "domestic" ? "domestic" : "international"} />
        </div>
      </div>

      {/* Rankings */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="strip-card">
          <p className="strip-label mb-4">Top Airports (International, PK)</p>
          <RankingTable rows={airports?.international.slice(0, 10) ?? []} labelKey="Airport" />
          <p className="mt-3 font-data text-[10px] text-strip-partial">Islamabad merges BBIAP/Chaklala + IIAP (2018 relocation)</p>
        </div>
        <div className="strip-card">
          <p className="strip-label mb-4">Top Airlines (International)</p>
          <RankingTable rows={airlines} labelKey="Airline" />
        </div>
      </div>

      {/* Cargo chart */}
      <div className="strip-card">
        <p className="strip-label mb-4">Cargo Trends (Metric Tons)</p>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" />
            <XAxis dataKey="year" tick={{ fill: "#8fa3bf", fontSize: 11 }} />
            <YAxis tick={{ fill: "#8fa3bf", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "#121f38", border: "1px solid #1e3054" }} />
            <Legend />
            <Bar dataKey="intlCargo" name="Intl Cargo" fill={CHART_COLORS.intl} />
            <Bar dataKey="domCargo" name="Dom Cargo" fill={CHART_COLORS.dom} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Insights */}
      <div className="strip-card">
        <p className="strip-label mb-4">CASE Insights</p>
        <div className="grid gap-4 md:grid-cols-2">
          {insights.map((ins) => (
            <div key={ins.title} className="rounded border border-strip-border bg-strip-bg p-4">
              <h4 className="font-display font-bold text-strip-signal">{ins.title}</h4>
              <p className="mt-2 text-sm text-strip-muted">{ins.body}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="font-data text-xs text-strip-muted">
        Source: Pakistan CAA government traffic statistics, 2006–2026. Passenger counts are directional flight-leg movements, not unique travelers.
      </p>
    </div>
  );
}
