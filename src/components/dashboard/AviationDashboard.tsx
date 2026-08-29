import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AirlineYAxisTick,
  CHART_TOOLTIP_STYLE,
  DashCard,
  DATA_YEAR_MAX,
  DATA_YEAR_MIN,
  InactiveBadge,
  MonthPickerControl,
  MONTHS,
  SegmentToggle,
  segmentLabel,
  YearPickerControl,
  YearRangeControl,
  type Segment,
} from "./DashboardUI";

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

type EntityRow = { name: string; passengers: number; cargo_tons: number; flights: number };
type YearlyTopEntities = {
  airlines: Record<string, Record<string, EntityRow[]>>;
  airports: Record<string, Record<string, EntityRow[]>>;
};
type PeriodEntityRankings = {
  airlines: Record<string, Record<string, EntityRow[]>>;
  airports: Record<string, Record<string, EntityRow[]>>;
};
type AirlineYearRow = { year: number; airline: string; passengers: number };
type AirportRow = { airport: string; passengers: number; cargo_tons: number };
type AirlineRow = { airline: string; passengers: number };
type SeasonalityRow = { year: number; month: number; segment: string; passengers: number };
type MonthlyCell = {
  year: number; month: number; segment: string; passengers: number;
  top_airlines: { airline: string; passengers: number }[];
};
type AirlineMeta = { airline: string; first_year: number; last_year: number; years_active: number; inactive: boolean };
type CagrResult = {
  airline: string; cagr: number; startYear: number; endYear: number;
  startPax: number; endPax: number; segment: string; note: string;
};
type Insight = { title: string; body: string };
type MetricKey = "passengers" | "cargo_tons" | "flights";
type EntityType = "airline" | "airport";

const CHART_COLORS = { intl: "#4a90d9", dom: "#3ddc84", cargo: "#f5a623", flights: "#a78bfa" };
const CAGR_COLORS = ["#4a90d9", "#3ddc84", "#f5a623", "#e879f9", "#38bdf8", "#fb7185"];

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function formatCargo(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const METRIC_OPTIONS: { key: MetricKey; label: string; color: string; format: (n: number) => string }[] = [
  { key: "passengers", label: "Passengers", color: CHART_COLORS.intl, format: formatNum },
  { key: "cargo_tons", label: "Cargo (MT)", color: CHART_COLORS.cargo, format: formatCargo },
  { key: "flights", label: "Flight Legs", color: CHART_COLORS.flights, format: formatNum },
];

function tooltipFormatter(value: number, name: string) {
  const label = String(name).toLowerCase().includes("cargo") ? formatCargo(value) : formatNum(value);
  return [label, name];
}

function computeCagr(start: number, end: number, years: number): number | null {
  if (years <= 0 || start <= 0 || end <= 0) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

function buildMetaMap(meta: { airlines: AirlineMeta[] } | null): Map<string, AirlineMeta> {
  const m = new Map<string, AirlineMeta>();
  meta?.airlines.forEach((a) => m.set(a.airline, a));
  return m;
}

function calcCagrForAirline(
  yearMap: Map<number, number>,
  rangeStart: number,
  rangeEnd: number,
): { cagr: number; startYear: number; endYear: number; startPax: number; endPax: number; note: string } | null {
  const yearsInRange = [...yearMap.keys()].filter((y) => y >= rangeStart && y <= rangeEnd).sort((a, b) => a - b);
  if (yearsInRange.length < 2) return null;
  const startYear = yearsInRange[0];
  const endYear = yearsInRange[yearsInRange.length - 1];
  const span = endYear - startYear;
  if (span <= 0) return null;
  const startPax = yearMap.get(startYear) ?? 0;
  const endPax = yearMap.get(endYear) ?? 0;
  const cagr = computeCagr(startPax, endPax, span);
  if (cagr === null || startPax < 100) return null;
  const gaps = yearsInRange.length - 1 < span;
  let note = `Data: ${startYear}–${endYear}`;
  if (startYear > rangeStart) note += ` (starts ${startYear}, no data before)`;
  if (endYear < rangeEnd) note += ` (ends ${endYear}, no data after)`;
  if (gaps) note += `. Gaps in between — CAGR uses endpoints only`;
  return { cagr, startYear, endYear, startPax, endPax, note };
}

function Heatmap({
  seasonality,
  monthlyBreakdown,
  segment,
  yearRange,
  metaMap,
}: {
  seasonality: SeasonalityRow[];
  monthlyBreakdown: MonthlyCell[];
  segment: Segment;
  yearRange: [number, number];
  metaMap: Map<string, AirlineMeta>;
}) {
  const [hover, setHover] = useState<{
    year: number; month: number; x: number; y: number;
  } | null>(null);

  const cellLookup = useMemo(() => {
    const m = new Map<string, MonthlyCell>();
    const segKey = segment === "all" ? "all" : segment;
    for (const c of monthlyBreakdown) {
      if (c.segment === segKey) m.set(`${c.year}-${c.month}`, c);
    }
    return m;
  }, [monthlyBreakdown, segment]);

  const filtered = seasonality.filter((d) => {
    const inRange = d.year >= yearRange[0] && d.year <= yearRange[1];
    const segMatch = segment === "all" || d.segment === segment;
    return inRange && segMatch;
  });

  const years = [...new Set(filtered.map((d) => d.year))].sort();
  const maxPax = Math.max(...filtered.map((d) => d.passengers), 1);

  const getCellPax = (year: number, month: number) => {
    const key = `${year}-${month}`;
    const cell = cellLookup.get(key);
    if (cell) return cell.passengers;
    return filtered.filter((d) => d.year === year && d.month === month).reduce((s, d) => s + d.passengers, 0);
  };

  const hoverCell = hover ? cellLookup.get(`${hover.year}-${hover.month}`) : null;
  const hoverPax = hover ? getCellPax(hover.year, hover.month) : 0;

  if (years.length === 0) {
    return <p className="font-data text-sm text-strip-muted">No data for selected filters.</p>;
  }

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <div className="min-w-[780px]">
          <div className="mb-2 flex gap-1 pl-14">
            {MONTHS.map((m) => (
              <div key={m} className="flex-1 text-center font-data text-[10px] text-strip-muted">{m}</div>
            ))}
          </div>
          {years.map((year) => (
            <div key={year} className="mb-0.5 flex items-center gap-1">
              <div className="w-12 shrink-0 font-data text-[10px] text-strip-muted">
                {year}{(year === 2006 || year === 2026) ? "*" : ""}
              </div>
              {MONTHS.map((_, mi) => {
                const month = mi + 1;
                const val = getCellPax(year, month);
                const intensity = val / maxPax;
                const isPartial = (year === 2006 && mi < 6) || (year === 2026 && mi >= 6);
                return (
                  <div
                    key={mi}
                    className="aspect-square flex-1 cursor-crosshair rounded-sm transition ring-offset-1 hover:ring-2 hover:ring-strip-accent"
                    style={{
                      backgroundColor: isPartial
                        ? "rgba(90,109,138,0.2)"
                        : `rgba(74,144,217,${0.12 + intensity * 0.88})`,
                      border: isPartial ? "1px dashed rgba(90,109,138,0.4)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHover({ year, month, x: rect.left + rect.width / 2, y: rect.top });
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
            </div>
          ))}
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <p className="font-data text-[10px] text-strip-partial">* Partial year: H2 2006 / H1 2026 (YTD). Hover any cell for details.</p>
            <div className="flex items-center gap-2">
              <span className="font-data text-[10px] text-strip-muted">Low</span>
              <div className="h-2 w-24 rounded" style={{ background: "linear-gradient(to right, rgba(74,144,217,0.15), rgba(74,144,217,0.95))" }} />
              <span className="font-data text-[10px] text-strip-muted">High</span>
            </div>
          </div>
        </div>
      </div>

      {hover && hoverPax > 0 && (
        <div
          className="pointer-events-none fixed z-50 min-w-[220px] max-w-[280px] rounded-lg border border-strip-accent bg-strip-surface p-4 shadow-2xl"
          style={{
            left: Math.min(hover.x - 110, window.innerWidth - 300),
            top: hover.y - 12,
            transform: "translateY(-100%)",
          }}
        >
          <p className="font-data text-[10px] uppercase tracking-wider text-strip-accent">
            {MONTHS[hover.month - 1]} {hover.year}
          </p>
          <p className="mt-2 font-data text-2xl font-bold text-strip-text">{formatNum(hoverPax)}</p>
          <p className="font-data text-xs text-strip-muted">total passengers</p>
          {hoverCell && hoverCell.top_airlines.length > 0 && (
            <div className="mt-3 border-t border-strip-border pt-3">
              <p className="font-data text-[10px] uppercase tracking-wider text-strip-muted">Top airlines</p>
              <ul className="mt-2 space-y-1.5">
                {hoverCell.top_airlines.map((a, i) => (
                  <li key={a.airline} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center text-strip-text">
                      <span className="mr-1.5 font-data text-strip-muted">{i + 1}.</span>
                      <span className="truncate max-w-[140px]">{a.airline}</span>
                      {metaMap.get(a.airline)?.inactive && <InactiveBadge />}
                    </span>
                    <span className="shrink-0 font-data text-strip-accent">{formatNum(a.passengers)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RankingTable({ rows, labelKey, metaMap }: { rows: (AirportRow | AirlineRow)[]; labelKey: string; metaMap?: Map<string, AirlineMeta> }) {
  if (rows.length === 0) {
    return <p className="font-data text-sm text-strip-muted">No data for selected filters.</p>;
  }
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
              <tr key={`${label}-${i}`} className="border-b border-strip-border/50">
                <td className="py-2 pr-4 text-strip-muted">{i + 1}</td>
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-1">
                    {label}
                    {labelKey === "Airline" && metaMap?.get(label)?.inactive && <InactiveBadge />}
                  </span>
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 max-w-[120px] flex-1 rounded bg-strip-border">
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

function mergeEntityRows(rows: EntityRow[]): EntityRow[] {
  const merged = new Map<string, EntityRow>();
  for (const row of rows) {
    const existing = merged.get(row.name);
    if (existing) {
      merged.set(row.name, {
        name: row.name,
        passengers: existing.passengers + row.passengers,
        cargo_tons: existing.cargo_tons + row.cargo_tons,
        flights: existing.flights + row.flights,
      });
    } else {
      merged.set(row.name, { ...row });
    }
  }
  return [...merged.values()];
}

function aggregatePeriodRankingsJson(
  periodRankings: PeriodEntityRankings,
  entityType: EntityType,
  segment: Segment,
  yearRange: [number, number],
  selectedYear: number | "all",
  selectedMonth: number | "all",
): EntityRow[] {
  const bucket = entityType === "airline" ? periodRankings.airlines : periodRankings.airports;
  const keys: string[] = [];

  if (selectedYear === "all" && selectedMonth === "all") {
    for (let y = yearRange[0]; y <= yearRange[1]; y++) {
      for (let m = 1; m <= 12; m++) keys.push(`${y}-${m}`);
    }
  } else if (selectedYear === "all") {
    for (let y = yearRange[0]; y <= yearRange[1]; y++) keys.push(`${y}-${selectedMonth}`);
  } else if (selectedMonth === "all") {
    for (let m = 1; m <= 12; m++) keys.push(`${selectedYear}-${m}`);
  } else {
    keys.push(`${selectedYear}-${selectedMonth}`);
  }

  const rows: EntityRow[] = [];
  const segments: ("international" | "domestic")[] = segment === "all" ? ["international", "domestic"] : [segment];
  for (const seg of segments) {
    for (const key of keys) {
      rows.push(...(bucket[seg]?.[key] ?? []));
    }
  }
  return mergeEntityRows(rows);
}

function aggregateYearlyTopJson(
  yearlyTop: YearlyTopEntities,
  entityType: EntityType,
  segment: Segment,
  years: number[],
): EntityRow[] {
  const bucket = entityType === "airline" ? yearlyTop.airlines : yearlyTop.airports;
  const rows: EntityRow[] = [];
  for (const year of years) {
    if (segment === "all") {
      const intl = bucket.international?.[String(year)] ?? [];
      const dom = bucket.domestic?.[String(year)] ?? [];
      rows.push(...intl, ...dom);
    } else {
      rows.push(...(bucket[segment]?.[String(year)] ?? []));
    }
  }
  return mergeEntityRows(rows);
}

type DuckConn = { query: (sql: string) => Promise<{ toArray: () => Record<string, unknown>[] }> };

async function queryEntityRankings(
  conn: DuckConn,
  opts: {
    entityType: EntityType;
    segment: Segment;
    yearRange: [number, number];
    selectedYear: number | "all";
    selectedMonth: number | "all";
  },
): Promise<EntityRow[]> {
  const { entityType, segment, yearRange, selectedYear, selectedMonth } = opts;
  const yearClause =
    selectedYear === "all"
      ? `(year BETWEEN ${yearRange[0]} AND ${yearRange[1]})`
      : `year = ${selectedYear}`;
  const monthClause = selectedMonth === "all" ? "" : `AND month = ${selectedMonth}`;

  const runAirlineQuery = (seg: string) =>
    conn.query(
      `SELECT airline AS name, SUM(passengers) AS passengers, SUM(cargo_tons) AS cargo_tons, COUNT(*) AS flights
       FROM traffic WHERE ${yearClause} ${monthClause} AND segment = '${seg}'
       GROUP BY 1 ORDER BY passengers DESC`,
    );

  const runIntlAirportQuery = () =>
    conn.query(
      `SELECT pk_airport AS name, SUM(passengers) AS passengers, SUM(cargo_tons) AS cargo_tons, COUNT(*) AS flights
       FROM traffic WHERE ${yearClause} ${monthClause} AND segment = 'international'
       GROUP BY 1 ORDER BY passengers DESC`,
    );

  const runDomAirportQuery = () =>
    conn.query(
      `SELECT airport AS name, SUM(passengers) AS passengers, SUM(cargo_tons) AS cargo_tons, COUNT(*) AS flights
       FROM (
         SELECT dep_airport AS airport, passengers, cargo_tons FROM traffic
         WHERE ${yearClause} ${monthClause} AND segment = 'domestic'
         UNION ALL
         SELECT arr_airport AS airport, passengers, cargo_tons FROM traffic
         WHERE ${yearClause} ${monthClause} AND segment = 'domestic'
       ) legs
       GROUP BY 1 ORDER BY passengers DESC`,
    );

  const toRows = (res: { toArray: () => Record<string, unknown>[] }) =>
    res.toArray().map((r) => ({
      name: String(r.name),
      passengers: Number(r.passengers ?? 0),
      cargo_tons: Number(r.cargo_tons ?? 0),
      flights: Number(r.flights ?? 0),
    }));

  if (entityType === "airline") {
    if (segment === "all") {
      const [intl, dom] = await Promise.all([runAirlineQuery("international"), runAirlineQuery("domestic")]);
      return mergeEntityRows([...toRows(intl), ...toRows(dom)]).sort((a, b) => b.passengers - a.passengers);
    }
    const res = await runAirlineQuery(segment);
    return toRows(res);
  }

  if (segment === "international") return toRows(await runIntlAirportQuery());
  if (segment === "domestic") return toRows(await runDomAirportQuery());
  const [intl, dom] = await Promise.all([runIntlAirportQuery(), runDomAirportQuery()]);
  return mergeEntityRows([...toRows(intl), ...toRows(dom)]).sort((a, b) => b.passengers - a.passengers);
}

function YearlyRankingsExplorer({
  yearlyTop,
  periodRankings,
  metaMap,
  duckConn,
  duckReady,
}: {
  yearlyTop: YearlyTopEntities | null;
  periodRankings: PeriodEntityRankings | null;
  metaMap: Map<string, AirlineMeta>;
  duckConn: unknown;
  duckReady: boolean;
}) {
  const yearRange: [number, number] = [DATA_YEAR_MIN, DATA_YEAR_MAX];
  const [segment, setSegment] = useState<Segment>("international");
  const [allYears, setAllYears] = useState(false);
  const [allMonths, setAllMonths] = useState(true);
  const [pickerYear, setPickerYear] = useState(DATA_YEAR_MAX - 1);
  const [pickerMonth, setPickerMonth] = useState(1);
  const selectedYear: number | "all" = allYears ? "all" : pickerYear;
  const selectedMonth: number | "all" = allMonths ? "all" : pickerMonth;
  const [entityType, setEntityType] = useState<EntityType>("airline");
  const [metrics, setMetrics] = useState<Set<MetricKey>>(new Set(["passengers", "cargo_tons", "flights"]));
  const [entityData, setEntityData] = useState<EntityRow[]>([]);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);

  const needsPeriodData = selectedMonth !== "all" || selectedYear === "all";

  const loadFromJson = useCallback(() => {
    if (needsPeriodData) {
      if (!periodRankings) return null;
      return aggregatePeriodRankingsJson(
        periodRankings, entityType, segment, yearRange, selectedYear, selectedMonth,
      );
    }
    if (!yearlyTop) return null;
    const years = [selectedYear as number];
    return aggregateYearlyTopJson(yearlyTop, entityType, segment, years);
  }, [needsPeriodData, periodRankings, yearlyTop, entityType, segment, yearRange, selectedYear, selectedMonth]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setRankingsError(null);

      if (duckConn && duckReady) {
        setRankingsLoading(true);
        try {
          const rows = await queryEntityRankings(duckConn as DuckConn, {
            entityType,
            segment,
            yearRange,
            selectedYear,
            selectedMonth,
          });
          if (!cancelled) setEntityData(rows);
          return;
        } catch (err) {
          console.error("Rankings DuckDB query failed:", err);
          if (!cancelled) setRankingsError("Live query failed — using cached rankings.");
        } finally {
          if (!cancelled) setRankingsLoading(false);
        }
      }

      const jsonRows = loadFromJson();
      if (!cancelled) {
        if (jsonRows) {
          setEntityData(jsonRows.sort((a, b) => b.passengers - a.passengers));
        } else if (needsPeriodData && !periodRankings) {
          setEntityData([]);
        } else if (!needsPeriodData && !yearlyTop) {
          setEntityData([]);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [yearlyTop, periodRankings, entityType, segment, selectedYear, selectedMonth, yearRange, duckConn, duckReady, loadFromJson, needsPeriodData]);

  const toggleMetric = (key: MetricKey) => {
    setMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const activeMetrics = METRIC_OPTIONS.filter((m) => metrics.has(m.key));
  const periodLabel =
    selectedYear === "all"
      ? `${yearRange[0]}–${yearRange[1]}${selectedMonth !== "all" ? ` · ${MONTHS[selectedMonth - 1]}` : ""}`
      : `${selectedYear}${selectedMonth !== "all" ? ` · ${MONTHS[selectedMonth - 1]}` : ""}`;
  const duckPending = !duckReady && needsPeriodData && !periodRankings;

  return (
    <DashCard
      label="Period Rankings"
      title="Top Airlines & Airports by Period"
      description="Sorted highest to lowest. Flight legs = individual movement records per CAA reporting (one row per leg)."
      accent="signal"
      filters={
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div>
            <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Segment</p>
            <SegmentToggle value={segment} onChange={setSegment} />
          </div>
          <div>
            <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Year</p>
            <YearPickerControl
              allYears={allYears}
              onAllYearsChange={setAllYears}
              year={pickerYear}
              onYearChange={setPickerYear}
            />
          </div>
          <div>
            <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Month</p>
            <MonthPickerControl
              allMonths={allMonths}
              onAllMonthsChange={setAllMonths}
              month={pickerMonth}
              onMonthChange={setPickerMonth}
            />
          </div>
          <div>
            <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Entity</p>
            <div className="flex gap-1.5">
              {(["airline", "airport"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEntityType(t)}
                  className={`segment-btn flex-1 capitalize ${entityType === t ? "segment-btn-active" : ""}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Metrics</p>
            <div className="flex flex-wrap gap-1.5">
              {METRIC_OPTIONS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleMetric(m.key)}
                  className={`segment-btn ${metrics.has(m.key) ? "segment-btn-active" : ""}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      }
    >
      {duckPending && (
        <p className="mt-4 font-data text-xs text-strip-muted">Loading SQL engine for live period rankings…</p>
      )}
      {rankingsLoading && (
        <p className="mt-4 font-data text-xs text-strip-muted">Querying rankings…</p>
      )}
      {rankingsError && (
        <p className="mt-4 font-data text-xs text-strip-partial">{rankingsError}</p>
      )}

      <div className={`mt-8 grid gap-6 ${activeMetrics.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {activeMetrics.map((metric) => {
          const sorted = [...entityData].sort((a, b) => b[metric.key] - a[metric.key]);
          const chartData = sorted.map((r) => ({
            name: r.name.length > 20 ? `${r.name.slice(0, 18)}…` : r.name,
            fullName: r.name,
            value: r[metric.key],
          }));
          const yAxisWidth = entityType === "airline" ? 168 : 120;
          const tickSize = entityType === "airline" ? 11 : 10;

          return (
            <div key={metric.key} className="rounded-lg border border-strip-border/60 bg-strip-bg/40 p-4">
              <p className="font-data text-xs uppercase tracking-wider text-strip-muted">
                {metric.label} — {periodLabel} ({sorted.length} {entityType === "airline" ? "airlines" : "airports"})
              </p>
              {sorted.length === 0 ? (
                <p className="mt-4 font-data text-sm text-strip-muted">
                  {rankingsLoading || duckPending ? "Loading rankings…" : "No data for this selection."}
                </p>
              ) : (
                <div className="mt-4 max-h-[520px] overflow-y-auto">
                  <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 28)}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "#8fa3bf", fontSize: 10 }} tickFormatter={metric.format} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={yAxisWidth}
                        tick={(props) => (
                          entityType === "airline" ? (
                            <AirlineYAxisTick
                              {...props}
                              items={chartData}
                              metaMap={metaMap}
                              fontSize={tickSize}
                            />
                          ) : (
                            <text x={props.x} y={props.y} dy={4} textAnchor="end" fill="#c5d4e8" fontSize={10} fontFamily="JetBrains Mono">
                              {props.payload?.value}
                            </text>
                          )
                        )}
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(v: number) => [metric.format(v), metric.label]}
                        labelFormatter={(_, payload) => {
                          const fullName = payload?.[0]?.payload?.fullName ?? "";
                          if (entityType === "airline" && metaMap.get(fullName)?.inactive) {
                            return `${fullName} — Inactive`;
                          }
                          return fullName;
                        }}
                      />
                      <Bar dataKey="value" fill={metric.color} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}

function AirlineCagrChart({
  airlineYearly,
  metaMap,
}: {
  airlineYearly: { international: AirlineYearRow[]; domestic: AirlineYearRow[] } | null;
  metaMap: Map<string, AirlineMeta>;
}) {
  const [cagrYearRange, setCagrYearRange] = useState<[number, number]>([2007, 2025]);
  const [cagrSegment, setCagrSegment] = useState<"international" | "domestic" | "both">("both");
  const [selectedAirlines, setSelectedAirlines] = useState<Set<string>>(new Set());

  const cagrResults = useMemo((): CagrResult[] => {
    if (!airlineYearly) return [];

    const calcForSeg = (rows: AirlineYearRow[], segLabel: string) => {
      const byAirline = new Map<string, Map<number, number>>();
      for (const r of rows) {
        if (!byAirline.has(r.airline)) byAirline.set(r.airline, new Map());
        const ym = byAirline.get(r.airline)!;
        ym.set(r.year, (ym.get(r.year) ?? 0) + r.passengers);
      }
      const results: CagrResult[] = [];
      for (const [airline, yearMap] of byAirline) {
        const calc = calcCagrForAirline(yearMap, cagrYearRange[0], cagrYearRange[1]);
        if (calc) {
          results.push({ airline, segment: segLabel, ...calc });
        }
      }
      return results;
    };

    if (cagrSegment === "both") {
      const byAirline = new Map<string, Map<number, number>>();
      for (const rows of [airlineYearly.international, airlineYearly.domestic]) {
        for (const r of rows) {
          if (!byAirline.has(r.airline)) byAirline.set(r.airline, new Map());
          const ym = byAirline.get(r.airline)!;
          ym.set(r.year, (ym.get(r.year) ?? 0) + r.passengers);
        }
      }
      const results: CagrResult[] = [];
      for (const [airline, yearMap] of byAirline) {
        const calc = calcCagrForAirline(yearMap, cagrYearRange[0], cagrYearRange[1]);
        if (calc) {
          results.push({ airline, segment: "Combined", ...calc });
        }
      }
      return results.sort((a, b) => b.cagr - a.cagr);
    }
    if (cagrSegment === "international") {
      return calcForSeg(airlineYearly.international, "International").sort((a, b) => b.cagr - a.cagr);
    }
    return calcForSeg(airlineYearly.domestic, "Domestic").sort((a, b) => b.cagr - a.cagr);
  }, [airlineYearly, cagrYearRange, cagrSegment]);

  const barData = useMemo(() =>
    cagrResults.map((d) => ({
      name: d.airline.length > 20 ? `${d.airline.slice(0, 18)}…` : d.airline,
      fullName: d.airline,
      cagr: Math.round(d.cagr * 10) / 10,
      segment: d.segment,
      inactive: metaMap.get(d.airline)?.inactive ?? false,
      note: d.note,
    })),
  [cagrResults, metaMap]);

  const footnotes = useMemo(() =>
    cagrResults.map((d) => ({
      airline: d.airline,
      inactive: metaMap.get(d.airline)?.inactive ?? false,
      note: d.note,
      cagr: Math.round(d.cagr * 10) / 10,
    })),
  [cagrResults, metaMap]);

  const trendData = useMemo(() => {
    if (!airlineYearly || selectedAirlines.size === 0) return [];
    const years: number[] = [];
    for (let y = cagrYearRange[0]; y <= cagrYearRange[1]; y++) years.push(y);
    return years.map((year) => {
      const row: Record<string, number | string> = { year };
      for (const airline of selectedAirlines) {
        const intl = airlineYearly.international.find((r) => r.year === year && r.airline === airline)?.passengers ?? 0;
        const dom = airlineYearly.domestic.find((r) => r.year === year && r.airline === airline)?.passengers ?? 0;
        row[airline] = intl + dom;
      }
      return row;
    });
  }, [airlineYearly, selectedAirlines, cagrYearRange]);

  const allAirlinesForPicker = useMemo(() => cagrResults.map((d) => d.airline), [cagrResults]);

  const toggleAirline = (name: string) => {
    setSelectedAirlines((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else if (next.size < 6) next.add(name);
      return next;
    });
  };

  return (
    <DashCard
      label="Growth Analysis"
      title="Airline Passenger CAGR"
      description="Independent per-chart analysis. CAGR uses each airline's first and last available year within the selected range — missing intermediate years do not exclude an airline. All qualifying airlines shown, highest to lowest."
      accent="warn"
      filters={
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">CAGR year window</p>
            <YearRangeControl value={cagrYearRange} onChange={setCagrYearRange} />
          </div>
          <div>
            <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Segment</p>
            <div className="flex flex-wrap gap-1.5">
              {(["international", "domestic", "both"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setCagrSegment(s)}
                  className={`segment-btn capitalize ${cagrSegment === s ? "segment-btn-active" : ""}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      }
    >
      {barData.length === 0 ? (
        <p className="mt-6 font-data text-sm text-strip-muted">No airlines with sufficient data in this range. Try widening the year window.</p>
      ) : (
        <div className="mt-2 max-h-[720px] overflow-y-auto rounded-lg border border-strip-border/40 bg-strip-bg/30 p-2">
          <ResponsiveContainer width="100%" height={Math.max(360, barData.length * 34)}>
          <BarChart data={barData} layout="vertical" margin={{ left: 12, right: 48, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" horizontal={false} />
            <XAxis type="number" tick={{ fill: "#a8bdd8", fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
            <YAxis
              type="category"
              dataKey="name"
              width={200}
              tick={(props) => (
                <AirlineYAxisTick {...props} items={barData} metaMap={metaMap} fontSize={13} />
              )}
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(v: number) => [`${v}%`, "CAGR"]}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload;
                return p ? `${p.fullName} (${p.segment})${p.inactive ? " — Inactive" : ""}` : "";
              }}
            />
            <Bar dataKey="cagr" radius={[0, 4, 4, 0]} label={{ position: "right", fill: "#a8bdd8", fontSize: 11, formatter: (v: number) => `${v}%` }}>
              {barData.map((entry, i) => (
                <Cell key={i} fill={entry.cagr >= 0 ? CHART_COLORS.intl : "#fb7185"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      )}

      {footnotes.length > 0 && (
        <div className="mt-4 rounded border border-strip-border bg-strip-bg/60 p-4">
          <p className="font-data text-[10px] uppercase tracking-wider text-strip-muted">Data coverage notes</p>
          <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
            {footnotes.map((f) => (
              <li key={f.airline} className="font-data text-[11px] text-strip-muted">
                <span className="text-strip-text">{f.airline}</span>
                {f.inactive && <InactiveBadge />}
                <span className="text-strip-muted"> — CAGR {f.cagr}% · {f.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 border-t border-strip-border pt-6">
        <p className="font-data text-xs uppercase tracking-wider text-strip-muted">Compare airlines over time (select up to 6)</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {allAirlinesForPicker.map((name) => (
            <button
              key={name}
              onClick={() => toggleAirline(name)}
              className={`rounded border px-2 py-1 font-data text-[10px] ${
                selectedAirlines.has(name) ? "border-strip-signal bg-strip-signal/15 text-strip-signal" : "border-strip-border text-strip-muted"
              }`}
            >
              {name.length > 20 ? `${name.slice(0, 18)}…` : name}
              {metaMap.get(name)?.inactive && <InactiveBadge />}
            </button>
          ))}
        </div>
        {selectedAirlines.size > 0 && (
          <ResponsiveContainer width="100%" height={260} className="mt-4">
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" />
              <XAxis dataKey="year" tick={{ fill: "#8fa3bf", fontSize: 10 }} />
              <YAxis tick={{ fill: "#8fa3bf", fontSize: 10 }} tickFormatter={formatNum} />
              <Tooltip contentStyle={{ background: "#121f38", border: "1px solid #1e3054", fontFamily: "JetBrains Mono" }} formatter={tooltipFormatter} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {[...selectedAirlines].map((name, i) => (
                <Line key={name} type="monotone" dataKey={name} stroke={CAGR_COLORS[i % CAGR_COLORS.length]} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </DashCard>
  );
}

export default function AviationDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<YearlyTrend[]>([]);
  const [seasonality, setSeasonality] = useState<SeasonalityRow[]>([]);
  const [airports, setAirports] = useState<{ international: AirportRow[]; domestic: AirportRow[] } | null>(null);
  const [airlineRankings, setAirlineRankings] = useState<{
    international: { by_passengers: AirlineRow[] };
    domestic: { by_passengers: AirlineRow[] };
  } | null>(null);
  const [yearlyTop, setYearlyTop] = useState<YearlyTopEntities | null>(null);
  const [periodRankings, setPeriodRankings] = useState<PeriodEntityRankings | null>(null);
  const [airlineYearly, setAirlineYearly] = useState<{ international: AirlineYearRow[]; domestic: AirlineYearRow[] } | null>(null);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState<MonthlyCell[]>([]);
  const [airlineMeta, setAirlineMeta] = useState<{ airlines: AirlineMeta[] } | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [trendsSegment, setTrendsSegment] = useState<Segment>("international");
  const [trendsYearRange, setTrendsYearRange] = useState<[number, number]>([DATA_YEAR_MIN, DATA_YEAR_MAX]);
  const [heatmapSegment, setHeatmapSegment] = useState<Segment>("international");
  const [heatmapYearRange, setHeatmapYearRange] = useState<[number, number]>([DATA_YEAR_MIN, DATA_YEAR_MAX]);
  const [airportsSegment, setAirportsSegment] = useState<Segment>("international");
  const [airportsYearRange, setAirportsYearRange] = useState<[number, number]>([DATA_YEAR_MIN, DATA_YEAR_MAX]);
  const [airlinesSegment, setAirlinesSegment] = useState<Segment>("international");
  const [airlinesYearRange, setAirlinesYearRange] = useState<[number, number]>([DATA_YEAR_MIN, DATA_YEAR_MAX]);
  const [cargoSegment, setCargoSegment] = useState<Segment>("international");
  const [cargoYearRange, setCargoYearRange] = useState<[number, number]>([DATA_YEAR_MIN, DATA_YEAR_MAX]);
  const [duckReady, setDuckReady] = useState(false);
  const [duckLoading, setDuckLoading] = useState(false);
  const [duckConn, setDuckConn] = useState<unknown>(null);
  const [sectionAirports, setSectionAirports] = useState<AirportRow[]>([]);
  const [sectionAirlines, setSectionAirlines] = useState<AirlineRow[]>([]);
  const [trendsKpis, setTrendsKpis] = useState<{ passengers: number; cargo: number } | null>(null);

  const filterTrends = useCallback((rows: YearlyTrend[], segment: Segment, yearRange: [number, number]) =>
    rows.filter(
      (t) => t.year >= yearRange[0] && t.year <= yearRange[1] && (segment === "all" || t.segment === segment),
    ), []);

  const buildChartData = useCallback((filtered: YearlyTrend[], segment: Segment) => {
    const years = [...new Set(filtered.map((t) => t.year))].sort();
    return years.map((year) => {
      const intl = filtered.find((t) => t.year === year && t.segment === "international");
      const dom = filtered.find((t) => t.year === year && t.segment === "domestic");
      const row: Record<string, number | boolean> = { year, partial: !!(intl?.partial_year || dom?.partial_year) };
      if (segment === "all" || segment === "international") {
        row.intlPax = intl?.passengers ?? 0;
        row.intlCargo = intl?.cargo_tons ?? 0;
      }
      if (segment === "all" || segment === "domestic") {
        row.domPax = dom?.passengers ?? 0;
        row.domCargo = dom?.cargo_tons ?? 0;
      }
      return row;
    });
  }, []);

  const trendsFiltered = useMemo(
    () => filterTrends(trends, trendsSegment, trendsYearRange),
    [trends, trendsSegment, trendsYearRange, filterTrends],
  );
  const cargoFiltered = useMemo(
    () => filterTrends(trends, cargoSegment, cargoYearRange),
    [trends, cargoSegment, cargoYearRange, filterTrends],
  );
  const trendsChartData = useMemo(() => buildChartData(trendsFiltered, trendsSegment), [trendsFiltered, trendsSegment, buildChartData]);
  const cargoChartData = useMemo(() => buildChartData(cargoFiltered, cargoSegment), [cargoFiltered, cargoSegment, buildChartData]);
  const trendsJsonKpis = useMemo(() => ({
    passengers: trendsFiltered.reduce((s, t) => s + t.passengers, 0),
    cargo: trendsFiltered.reduce((s, t) => s + t.cargo_tons, 0),
  }), [trendsFiltered]);

  useEffect(() => {
    Promise.all([
      fetch("/data/aviation/summary.json").then((r) => r.json()),
      fetch("/data/aviation/yearly-trends.json").then((r) => r.json()),
      fetch("/data/aviation/monthly-seasonality.json").then((r) => r.json()),
      fetch("/data/aviation/airport-traffic.json").then((r) => r.json()),
      fetch("/data/aviation/airline-rankings.json").then((r) => r.json()),
      fetch("/data/aviation/insights.json").then((r) => r.json()),
      fetch("/data/aviation/yearly-top-entities.json").then((r) => r.json()),
      fetch("/data/aviation/period-entity-rankings.json").then((r) => r.json()),
      fetch("/data/aviation/airline-yearly-passengers.json").then((r) => r.json()),
      fetch("/data/aviation/monthly-airline-breakdown.json").then((r) => r.json()),
      fetch("/data/aviation/airline-metadata.json").then((r) => r.json()),
    ]).then(([s, t, seas, apt, aln, ins, ytop, period, aly, monthly, meta]) => {
      setSummary(s);
      setTrends(t);
      setSeasonality(seas);
      setAirports(apt);
      setAirlineRankings(aln);
      setInsights(ins.findings);
      setYearlyTop(ytop);
      setPeriodRankings(period);
      setAirlineYearly(aly);
      setMonthlyBreakdown(monthly);
      setAirlineMeta(meta);
    });
  }, []);

  const staticAirports = useMemo(() => {
    if (!airports) return [];
    if (airportsSegment === "domestic") return airports.domestic.slice(0, 10);
    return airports.international.slice(0, 10);
  }, [airports, airportsSegment]);

  const staticAirlines = useMemo(() => {
    if (!airlineRankings) return [];
    if (airlinesSegment === "domestic") return airlineRankings.domestic.by_passengers.slice(0, 15);
    return airlineRankings.international.by_passengers.slice(0, 15);
  }, [airlineRankings, airlinesSegment]);

  const querySection = useCallback(async (
    segment: Segment,
    yearRange: [number, number],
    onKpis: (k: { passengers: number; cargo: number }) => void,
    onAirports: (r: AirportRow[]) => void,
    onAirlines: (r: AirlineRow[]) => void,
  ) => {
    if (!duckConn || !duckReady) return;
    const conn = duckConn as { query: (sql: string) => Promise<{ toArray: () => Record<string, unknown>[] }> };
    const segFilter = segment === "all" ? "" : `AND segment = '${segment}'`;

    const kpiRes = await conn.query(
      `SELECT SUM(passengers) as passengers, SUM(cargo_tons) as cargo_tons
       FROM traffic WHERE year BETWEEN ${yearRange[0]} AND ${yearRange[1]} ${segFilter}`,
    );
    const kpiRow = kpiRes.toArray()[0];
    onKpis({ passengers: Number(kpiRow.passengers ?? 0), cargo: Number(kpiRow.cargo_tons ?? 0) });

    const airportCol = segment === "domestic" ? "dep_airport" : "pk_airport";
    const aptRes = await conn.query(
      `SELECT ${airportCol} as airport, SUM(passengers) as passengers, SUM(cargo_tons) as cargo_tons
       FROM traffic WHERE year BETWEEN ${yearRange[0]} AND ${yearRange[1]} ${segFilter}
       GROUP BY 1 ORDER BY passengers DESC LIMIT 10`,
    );
    onAirports(aptRes.toArray().map((r) => ({
      airport: String(r.airport), passengers: Number(r.passengers), cargo_tons: Number(r.cargo_tons),
    })));

    const alnRes = await conn.query(
      `SELECT airline, SUM(passengers) as passengers
       FROM traffic WHERE year BETWEEN ${yearRange[0]} AND ${yearRange[1]} ${segFilter}
       GROUP BY 1 ORDER BY passengers DESC LIMIT 15`,
    );
    onAirlines(alnRes.toArray().map((r) => ({
      airline: String(r.airline), passengers: Number(r.passengers),
    })));
  }, [duckConn, duckReady]);

  const initDuckDB = useCallback(async () => {
    if (duckReady || duckLoading) return;
    setDuckLoading(true);
    try {
      const duckdb = await import("@duckdb/duckdb-wasm");
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const worker = new Worker(bundle.mainWorker!);
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      const buf = new Uint8Array(await (await fetch("/data/aviation/traffic.parquet")).arrayBuffer());
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
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) initDuckDB(); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [initDuckDB]);

  useEffect(() => {
    if (!duckReady) return;
    querySection(trendsSegment, trendsYearRange, setTrendsKpis, () => {}, () => {});
  }, [duckReady, querySection, trendsSegment, trendsYearRange]);

  useEffect(() => {
    if (!duckReady) return;
    querySection(airportsSegment, airportsYearRange, () => {}, setSectionAirports, () => {});
  }, [duckReady, querySection, airportsSegment, airportsYearRange]);

  useEffect(() => {
    if (!duckReady) return;
    querySection(airlinesSegment, airlinesYearRange, () => {}, () => {}, setSectionAirlines);
  }, [duckReady, querySection, airlinesSegment, airlinesYearRange]);

  const exportCsv = async (segment: Segment, yearRange: [number, number]) => {
    if (!duckConn) return;
    const segFilter = segment === "all" ? "" : `AND segment = '${segment}'`;
    const r = await (duckConn as { query: (sql: string) => Promise<{ toArray: () => Record<string, unknown>[] }> })
      .query(`SELECT year, month, airline, segment, passengers, cargo_tons FROM traffic WHERE year BETWEEN ${yearRange[0]} AND ${yearRange[1]} ${segFilter} LIMIT 5000`);
    const rows = r.toArray();
    if (!rows.length) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[Object.keys(rows[0]).join(","), ...rows.map((row) => Object.values(row).join(","))].join("\n")], { type: "text/csv" }));
    a.download = "aviation-export.csv";
    a.click();
  };

  const displayTrendsKpis = trendsKpis ?? trendsJsonKpis;
  const displayAirports = duckReady && sectionAirports.length > 0 ? sectionAirports : staticAirports;
  const displayAirlines = duckReady && sectionAirlines.length > 0 ? sectionAirlines : staticAirlines;
  const metaMap = useMemo(() => buildMetaMap(airlineMeta), [airlineMeta]);

  const chartFilters = (segment: Segment, setSegment: (s: Segment) => void, yearRange: [number, number], setYearRange: (r: [number, number]) => void) => (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Segment</p>
        <SegmentToggle value={segment} onChange={setSegment} />
      </div>
      <div>
        <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Year range</p>
        <YearRangeControl value={yearRange} onChange={setYearRange} />
      </div>
    </div>
  );

  if (!summary) {
    return <div className="dash-card p-8 text-center font-data text-strip-muted">Loading dashboard data…</div>;
  }

  return (
    <div id="aviation-dashboard" className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="kpi-card">
          <p className="strip-label">{segmentLabel(trendsSegment)} Passengers</p>
          <p className="mt-2 font-data text-2xl font-semibold text-strip-text">{formatNum(displayTrendsKpis.passengers)}</p>
          <p className="mt-1 font-data text-[10px] text-strip-muted">{trendsYearRange[0]}–{trendsYearRange[1]}</p>
        </div>
        <div className="kpi-card">
          <p className="strip-label">{segmentLabel(trendsSegment)} Cargo (MT)</p>
          <p className="mt-2 font-data text-2xl font-semibold text-strip-text">{formatCargo(displayTrendsKpis.cargo)}</p>
          <p className="mt-1 font-data text-[10px] text-strip-muted">{trendsYearRange[0]}–{trendsYearRange[1]}</p>
        </div>
        <div className="kpi-card">
          <p className="strip-label">Records</p>
          <p className="mt-2 font-data text-2xl font-semibold text-strip-text">173K+</p>
          <p className="mt-1 font-data text-[10px] text-strip-muted">Flight legs in dataset</p>
        </div>
        <div className="kpi-card">
          <p className="strip-label">Engine</p>
          <p className="mt-2 font-data text-lg font-semibold text-strip-signal">{duckReady ? "DuckDB live" : duckLoading ? "Loading…" : "JSON mode"}</p>
          <p className="mt-1 font-data text-[10px] text-strip-partial">* 2006 H2 / 2026 H1 partial</p>
        </div>
      </div>

      <DashCard
        label="Traffic Trends"
        title={`Passenger Trends — ${segmentLabel(trendsSegment)}`}
        filters={chartFilters(trendsSegment, setTrendsSegment, trendsYearRange, setTrendsYearRange)}
      >
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={trendsChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" />
            <XAxis dataKey="year" tick={{ fill: "#a8bdd8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#a8bdd8", fontSize: 11 }} tickFormatter={formatNum} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={tooltipFormatter} />
            <Legend />
            {trendsSegment === "all" && (
              <>
                <Line type="monotone" dataKey="intlPax" name="International" stroke={CHART_COLORS.intl} dot={false} strokeWidth={2.5} />
                <Line type="monotone" dataKey="domPax" name="Domestic" stroke={CHART_COLORS.dom} dot={false} strokeWidth={2.5} />
              </>
            )}
            {trendsSegment === "international" && <Line type="monotone" dataKey="intlPax" name="International" stroke={CHART_COLORS.intl} dot={false} strokeWidth={2.5} />}
            {trendsSegment === "domestic" && <Line type="monotone" dataKey="domPax" name="Domestic" stroke={CHART_COLORS.dom} dot={false} strokeWidth={2.5} />}
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => exportCsv(trendsSegment, trendsYearRange)} disabled={!duckReady} className="strip-btn text-xs disabled:opacity-40">
            Export CSV
          </button>
        </div>
      </DashCard>

      <DashCard
        label="Signature Visual"
        title={`Year × Month Heatmap — ${segmentLabel(heatmapSegment)}`}
        accent="signal"
        filters={chartFilters(heatmapSegment, setHeatmapSegment, heatmapYearRange, setHeatmapYearRange)}
      >
        <Heatmap seasonality={seasonality} monthlyBreakdown={monthlyBreakdown} segment={heatmapSegment} yearRange={heatmapYearRange} metaMap={metaMap} />
      </DashCard>

      <YearlyRankingsExplorer
        yearlyTop={yearlyTop}
        periodRankings={periodRankings}
        metaMap={metaMap}
        duckConn={duckConn}
        duckReady={duckReady}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <DashCard
          label="Rankings"
          title={`Top Airports — ${airportsSegment === "domestic" ? "Domestic" : "International (PK)"}`}
          filters={chartFilters(airportsSegment, setAirportsSegment, airportsYearRange, setAirportsYearRange)}
        >
          <RankingTable rows={displayAirports} labelKey="Airport" />
          {airportsSegment !== "domestic" && (
            <p className="mt-3 font-data text-[10px] text-strip-partial">Islamabad merges BBIAP/Chaklala + IIAP (2018 relocation)</p>
          )}
        </DashCard>
        <DashCard
          label="Rankings"
          title={`Top Airlines — ${segmentLabel(airlinesSegment)}`}
          filters={chartFilters(airlinesSegment, setAirlinesSegment, airlinesYearRange, setAirlinesYearRange)}
        >
          <RankingTable rows={displayAirlines} labelKey="Airline" metaMap={metaMap} />
        </DashCard>
      </div>

      <DashCard
        label="Cargo"
        title={`Cargo Trends (Metric Tons) — ${segmentLabel(cargoSegment)}`}
        accent="warn"
        filters={chartFilters(cargoSegment, setCargoSegment, cargoYearRange, setCargoYearRange)}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={cargoChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" />
            <XAxis dataKey="year" tick={{ fill: "#a8bdd8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#a8bdd8", fontSize: 11 }} tickFormatter={formatCargo} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={tooltipFormatter} />
            <Legend />
            {cargoSegment === "all" && (
              <>
                <Bar dataKey="intlCargo" name="Intl Cargo" fill={CHART_COLORS.intl} radius={[3, 3, 0, 0]} />
                <Bar dataKey="domCargo" name="Dom Cargo" fill={CHART_COLORS.dom} radius={[3, 3, 0, 0]} />
              </>
            )}
            {cargoSegment === "international" && <Bar dataKey="intlCargo" name="Intl Cargo" fill={CHART_COLORS.intl} radius={[3, 3, 0, 0]} />}
            {cargoSegment === "domestic" && <Bar dataKey="domCargo" name="Dom Cargo" fill={CHART_COLORS.dom} radius={[3, 3, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </DashCard>

      <AirlineCagrChart airlineYearly={airlineYearly} metaMap={metaMap} />

      <DashCard label="Insights" title="Key Findings" accent="signal">
        <div className="grid gap-4 md:grid-cols-2">
          {insights.map((ins) => (
            <div key={ins.title} className="rounded-lg border border-strip-border/60 bg-strip-bg/50 p-4 transition hover:border-strip-signal/30">
              <h4 className="font-display font-bold text-strip-signal">{ins.title}</h4>
              <p className="mt-2 text-sm leading-relaxed text-strip-muted">{ins.body}</p>
            </div>
          ))}
        </div>
      </DashCard>

      <p className="font-data text-xs text-strip-muted">
        Source: Pakistan CAA government traffic statistics, 2006–2026. Passenger counts are directional flight-leg movements, not unique travelers.
      </p>
    </div>
  );
}
