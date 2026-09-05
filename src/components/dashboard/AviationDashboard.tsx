import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AirlineYAxisTick,
  CHART_TOOLTIP_STYLE,
  DashCard,
  DashboardErrorBoundary,
  DATA_YEAR_MAX,
  DATA_YEAR_MIN,
  FULL_YEAR_RANGE,
  HeatmapFilterControls,
  InactiveBadge,
  MonthPickerControl,
  MONTHS,
  PeriodFilterControls,
  SegmentToggle,
  segmentLabel,
  StableChartContainer,
  YearPickerControl,
  YearRangeControl,
  type PeriodSelection,
  type Segment,
} from "./DashboardUI";

type Summary = {
  international: { passengers: number; cargo_tons: number };
  domestic: { passengers: number; cargo_tons: number };
  combined: { passengers: number; cargo_tons: number; year_range: number[]; rows?: number };
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
type PeriodEntityRankings = {
  airlines: Record<string, Record<string, EntityRow[]>>;
  airports: Record<string, Record<string, EntityRow[]>>;
};
type AirlineYearRow = { year: number; airline: string; passengers: number };
type SeasonalityRow = { year: number; month: number; segment: string; passengers: number; cargo_tons: number };
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

function formatPeriodLabel(period: PeriodSelection): string {
  if (period.selectedYear === "all") {
    return period.selectedMonth !== "all"
      ? `${MONTHS[period.selectedMonth - 1]} (all years)`
      : `${DATA_YEAR_MIN}–${DATA_YEAR_MAX}`;
  }
  return period.selectedMonth !== "all"
    ? `${period.selectedYear} · ${MONTHS[period.selectedMonth - 1]}`
    : `${period.selectedYear}`;
}

function escapeCsvCell(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function aggregateSeasonalityCargo(
  rows: SeasonalityRow[],
  keyFn: (r: SeasonalityRow) => number,
  labelFn: (key: number) => string,
): Record<string, number | string>[] {
  const byKey = new Map<number, { intl: number; dom: number }>();
  for (const r of rows) {
    const key = keyFn(r);
    const cur = byKey.get(key) ?? { intl: 0, dom: 0 };
    if (r.segment === "international") cur.intl += r.cargo_tons;
    else if (r.segment === "domestic") cur.dom += r.cargo_tons;
    byKey.set(key, cur);
  }
  return [...byKey.entries()].sort(([a], [b]) => a - b).map(([key, v]) => ({
    period: labelFn(key),
    intlCargo: v.intl,
    domCargo: v.dom,
    cargo: v.intl + v.dom,
  }));
}

function buildCargoChartData(
  trends: YearlyTrend[],
  seasonality: SeasonalityRow[],
  segment: Segment,
  period: PeriodSelection,
): { data: Record<string, number | string>[]; xKey: string } {
  const segMatch = (s: string) => segment === "all" || s === segment;

  // Specific year + specific month → single-period bar(s)
  if (period.selectedYear !== "all" && period.selectedMonth !== "all") {
    const rows = seasonality.filter(
      (d) => d.year === period.selectedYear && d.month === period.selectedMonth && segMatch(d.segment),
    );
    const data = aggregateSeasonalityCargo(rows, () => 0, () => formatPeriodLabel(period));
    return { data, xKey: "period" };
  }

  // Specific year, all months → monthly bars
  if (period.selectedYear !== "all" && period.selectedMonth === "all") {
    const rows = seasonality.filter((d) => d.year === period.selectedYear && segMatch(d.segment));
    return {
      data: aggregateSeasonalityCargo(rows, (r) => r.month, (m) => MONTHS[m - 1]),
      xKey: "period",
    };
  }

  // All years, specific month → that month across years
  if (period.selectedYear === "all" && period.selectedMonth !== "all") {
    const rows = seasonality.filter((d) => d.month === period.selectedMonth && segMatch(d.segment));
    return {
      data: aggregateSeasonalityCargo(rows, (r) => r.year, String),
      xKey: "period",
    };
  }

  // All years, all months → yearly totals
  const yearly = trends.filter((t) => segMatch(t.segment));
  const years = [...new Set(yearly.map((t) => t.year))].sort();
  const data = years.map((year) => {
    const intl = yearly.find((t) => t.year === year && t.segment === "international");
    const dom = yearly.find((t) => t.year === year && t.segment === "domestic");
    return {
      period: String(year),
      intlCargo: intl?.cargo_tons ?? 0,
      domCargo: dom?.cargo_tons ?? 0,
      cargo: (intl?.cargo_tons ?? 0) + (dom?.cargo_tons ?? 0),
    };
  });
  return { data, xKey: "period" };
}

function shortLabel(name: string, max = 20): string {
  return name.length > max ? `${name.slice(0, max - 2)}…` : name;
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
  selectedYear,
  metaMap,
}: {
  seasonality: SeasonalityRow[];
  monthlyBreakdown: MonthlyCell[];
  segment: Segment;
  selectedYear: number | "all";
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
    const yearOk = selectedYear === "all" || d.year === selectedYear;
    const segMatch = segment === "all" || d.segment === segment;
    return yearOk && segMatch;
  });

  const years = [...new Set(filtered.map((d) => d.year))].sort();

  const getCellPax = (year: number, month: number) => {
    const key = `${year}-${month}`;
    const cell = cellLookup.get(key);
    if (cell) return cell.passengers;
    return filtered.filter((d) => d.year === year && d.month === month).reduce((s, d) => s + d.passengers, 0);
  };

  const maxPax = Math.max(
    1,
    ...years.flatMap((year) => MONTHS.map((_, mi) => getCellPax(year, mi + 1))),
  );

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

function entityRowsEqual(a: EntityRow[], b: EntityRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => {
    const o = b[i];
    return o && r.name === o.name && r.passengers === o.passengers && r.cargo_tons === o.cargo_tons && r.flights === o.flights;
  });
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
  periodRankings,
  metaMap,
  duckConn,
  duckReady,
}: {
  periodRankings: PeriodEntityRankings | null;
  metaMap: Map<string, AirlineMeta>;
  duckConn: unknown;
  duckReady: boolean;
}) {
  const yearRange = FULL_YEAR_RANGE;
  const [segment, setSegment] = useState<Segment>("international");
  const [allYears, setAllYears] = useState(false);
  const [allMonths, setAllMonths] = useState(true);
  const [pickerYear, setPickerYear] = useState(DATA_YEAR_MAX - 1);
  const [pickerMonth, setPickerMonth] = useState(1);
  const selectedYear: number | "all" = allYears ? "all" : pickerYear;
  const selectedMonth: number | "all" = allMonths ? "all" : pickerMonth;
  const [entityType, setEntityType] = useState<EntityType>("airline");
  const [metrics, setMetrics] = useState<Set<MetricKey>>(new Set(["passengers"]));
  const [entityData, setEntityData] = useState<EntityRow[]>([]);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);

  const loadFromJson = useCallback(() => {
    if (!periodRankings) return null;
    return aggregatePeriodRankingsJson(
      periodRankings, entityType, segment, yearRange, selectedYear, selectedMonth,
    );
  }, [periodRankings, entityType, segment, selectedYear, selectedMonth]);

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
          if (!cancelled) {
            setEntityData((prev) => (entityRowsEqual(prev, rows) ? prev : rows));
          }
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
          setEntityData((prev) => {
            const next = jsonRows.sort((a, b) => b.passengers - a.passengers);
            if (entityRowsEqual(prev, next)) return prev;
            return next;
          });
        } else if (!periodRankings) {
          setEntityData([]);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [periodRankings, entityType, segment, selectedYear, selectedMonth, duckConn, duckReady, loadFromJson]);

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
  const duckPending = !duckReady && !periodRankings;

  return (
    <DashCard
      label="Period Rankings"
      title="Top Airlines & Airports by Period"
      description={
        entityType === "airport"
          ? "International uses the Pakistani endpoint (Arr/Dep). Domestic counts both ends of each leg (dep + arr), so passenger totals are throughput, not unique travelers. Flight legs = CAA movement records."
          : "Sorted highest to lowest. Flight legs = individual movement records per CAA reporting (one row per leg)."
      }
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
      {entityType === "airport" && segment === "all" && (
        <p className="mt-3 font-data text-[10px] text-strip-partial">
          Combined airport totals mix international (once per leg) with domestic (both endpoints). Prefer a single segment for like-for-like comparison.
        </p>
      )}

      <div className={`mt-8 grid gap-6 ${activeMetrics.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {activeMetrics.map((metric) => {
          const sorted = [...entityData].sort((a, b) => b[metric.key] - a[metric.key]);
          const chartData = sorted.map((r) => ({
            name: shortLabel(r.name, entityType === "airline" ? 20 : 18),
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
                  <StableChartContainer height={Math.max(220, chartData.length * 28)}>
                    {({ width, height }) => (
                    <BarChart width={width} height={height} data={chartData} layout="vertical" margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "#8fa3bf", fontSize: 10 }} tickFormatter={metric.format} />
                      <YAxis
                        type="category"
                        dataKey="fullName"
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
                            <g transform={`translate(${props.x},${props.y})`}>
                              <text dy={4} x={-6} textAnchor="end" fill="#c5d4e8" fontSize={10} fontFamily="JetBrains Mono">
                                {shortLabel(String(props.payload?.value ?? ""), 18)}
                              </text>
                            </g>
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
                      <Bar dataKey="value" fill={metric.color} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                    </BarChart>
                    )}
                  </StableChartContainer>
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
  const [cagrSegment, setCagrSegment] = useState<"international" | "domestic" | "all">("all");
  const [compareSegment, setCompareSegment] = useState<"international" | "domestic">("international");
  const [compareAirlines, setCompareAirlines] = useState<string[]>([]);
  const [comparePick, setComparePick] = useState("");

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

    if (cagrSegment === "all") {
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
      name: shortLabel(d.airline, 20),
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

  const compareAirlineOptions = useMemo(() => {
    if (!airlineYearly) return [];
    const rows = compareSegment === "international" ? airlineYearly.international : airlineYearly.domestic;
    return [...new Set(rows.map((r) => r.airline))].sort();
  }, [airlineYearly, compareSegment]);

  const trendData = useMemo(() => {
    if (!airlineYearly || compareAirlines.length === 0) return [];
    const rows = compareSegment === "international" ? airlineYearly.international : airlineYearly.domestic;
    const years = [...new Set(rows.filter((r) => compareAirlines.includes(r.airline)).map((r) => r.year))]
      .filter((y) => y >= cagrYearRange[0] && y <= cagrYearRange[1])
      .sort((a, b) => a - b);
    return years.map((year) => {
      const row: Record<string, number | string> = { year };
      for (const airline of compareAirlines) {
        row[airline] = rows.find((r) => r.year === year && r.airline === airline)?.passengers ?? 0;
      }
      return row;
    });
  }, [airlineYearly, compareAirlines, compareSegment, cagrYearRange]);

  const compareCagrData = useMemo(() => {
    if (!airlineYearly || compareAirlines.length === 0) return [];
    const rows = compareSegment === "international" ? airlineYearly.international : airlineYearly.domestic;
    return compareAirlines.map((airline) => {
      const yearMap = new Map<number, number>();
      for (const r of rows.filter((x) => x.airline === airline)) {
        yearMap.set(r.year, (yearMap.get(r.year) ?? 0) + r.passengers);
      }
      const calc = calcCagrForAirline(yearMap, cagrYearRange[0], cagrYearRange[1]);
      return {
        name: shortLabel(airline, 20),
        fullName: airline,
        cagr: calc ? Math.round(calc.cagr * 10) / 10 : null,
        inactive: metaMap.get(airline)?.inactive ?? false,
        note: calc?.note ?? "Insufficient data",
      };
    }).filter((d) => d.cagr !== null) as { name: string; fullName: string; cagr: number; inactive: boolean; note: string }[];
  }, [airlineYearly, compareAirlines, compareSegment, cagrYearRange, metaMap]);

  const addCompareAirline = () => {
    if (!comparePick || compareAirlines.includes(comparePick) || compareAirlines.length >= 6) return;
    setCompareAirlines((prev) => [...prev, comparePick]);
    setComparePick("");
  };

  const removeCompareAirline = (name: string) => {
    setCompareAirlines((prev) => prev.filter((a) => a !== name));
  };

  useEffect(() => {
    setCompareAirlines([]);
    setComparePick("");
  }, [compareSegment]);

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
              {(["international", "domestic", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setCagrSegment(s)}
                  className={`segment-btn capitalize ${cagrSegment === s ? "segment-btn-active" : ""}`}
                >
                  {s === "all" ? "Combined" : s}
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
          <StableChartContainer height={Math.max(360, barData.length * 34)}>
          {({ width, height }) => (
          <BarChart width={width} height={height} data={barData} layout="vertical" margin={{ left: 12, right: 48, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" horizontal={false} />
            <XAxis type="number" tick={{ fill: "#a8bdd8", fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
            <YAxis
              type="category"
              dataKey="fullName"
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
            <Bar dataKey="cagr" radius={[0, 4, 4, 0]} isAnimationActive={false} label={{ position: "right", fill: "#a8bdd8", fontSize: 11, formatter: (v: number) => `${v}%` }}>
              {barData.map((entry, i) => (
                <Cell key={i} fill={entry.cagr >= 0 ? CHART_COLORS.intl : "#fb7185"} />
              ))}
            </Bar>
          </BarChart>
          )}
        </StableChartContainer>
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
        <p className="font-data text-xs uppercase tracking-wider text-strip-muted">Compare airlines over time (up to 6)</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Segment</p>
            <div className="flex gap-1.5">
              {(["international", "domestic"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setCompareSegment(s)}
                  className={`segment-btn flex-1 capitalize ${compareSegment === s ? "segment-btn-active" : ""}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Add airline</p>
            <div className="flex gap-2">
              <select
                value={comparePick}
                onChange={(e) => setComparePick(e.target.value)}
                className="min-w-0 flex-1 rounded border border-strip-border bg-strip-bg px-2 py-1.5 font-data text-xs text-strip-text"
              >
                <option value="">Select airline…</option>
                {compareAirlineOptions
                  .filter((name) => !compareAirlines.includes(name))
                  .map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
              </select>
              <button
                type="button"
                onClick={addCompareAirline}
                disabled={!comparePick || compareAirlines.length >= 6}
                className="strip-btn shrink-0 text-xs disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>
        {compareAirlines.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {compareAirlines.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded border border-strip-signal/40 bg-strip-signal/10 px-2 py-1 font-data text-[10px] text-strip-signal"
              >
                {name.length > 24 ? `${name.slice(0, 22)}…` : name}
                {metaMap.get(name)?.inactive && <InactiveBadge compact />}
                <button
                  type="button"
                  onClick={() => removeCompareAirline(name)}
                  className="ml-0.5 text-strip-muted hover:text-strip-text"
                  aria-label={`Remove ${name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {compareAirlines.length > 0 && (
          <>
            <p className="mt-6 font-data text-[10px] uppercase tracking-wider text-strip-muted">Passengers over time</p>
            <StableChartContainer height={260} className="mt-3">
              {({ width, height }) => (
              <LineChart width={width} height={height} data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" />
                <XAxis dataKey="year" tick={{ fill: "#8fa3bf", fontSize: 10 }} />
                <YAxis tick={{ fill: "#8fa3bf", fontSize: 10 }} tickFormatter={formatNum} />
                <Tooltip contentStyle={{ background: "#121f38", border: "1px solid #1e3054", fontFamily: "JetBrains Mono" }} formatter={tooltipFormatter} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {compareAirlines.map((name, i) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={CAGR_COLORS[i % CAGR_COLORS.length]} dot={false} strokeWidth={2} isAnimationActive={false} />
                ))}
              </LineChart>
              )}
            </StableChartContainer>
            <p className="mt-6 font-data text-[10px] uppercase tracking-wider text-strip-muted">CAGR ({cagrYearRange[0]}–{cagrYearRange[1]})</p>
            {compareCagrData.length === 0 ? (
              <p className="mt-3 font-data text-sm text-strip-muted">Not enough data to compute CAGR for the selected airlines.</p>
            ) : (
              <StableChartContainer height={Math.max(180, compareCagrData.length * 40)} className="mt-3">
                {({ width, height }) => (
                <BarChart width={width} height={height} data={compareCagrData} layout="vertical" margin={{ left: 12, right: 48, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#a8bdd8", fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <YAxis
                    type="category"
                    dataKey="fullName"
                    width={200}
                    tick={(props) => (
                      <AirlineYAxisTick {...props} items={compareCagrData} metaMap={metaMap} fontSize={12} />
                    )}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(v: number) => [`${v}%`, "CAGR"]}
                    labelFormatter={(_, payload) => {
                      const p = payload?.[0]?.payload;
                      return p ? `${p.fullName}${p.inactive ? " — Inactive" : ""}` : "";
                    }}
                  />
                  <Bar dataKey="cagr" radius={[0, 4, 4, 0]} isAnimationActive={false} label={{ position: "right", fill: "#a8bdd8", fontSize: 11, formatter: (v: number) => `${v}%` }}>
                    {compareCagrData.map((entry, i) => (
                      <Cell key={i} fill={entry.cagr >= 0 ? CHART_COLORS.intl : "#fb7185"} />
                    ))}
                  </Bar>
                </BarChart>
                )}
              </StableChartContainer>
            )}
          </>
        )}
      </div>
    </DashCard>
  );
}

export default function AviationDashboard() {
  return (
    <DashboardErrorBoundary>
      <AviationDashboardInner />
    </DashboardErrorBoundary>
  );
}

function AviationDashboardInner() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<YearlyTrend[]>([]);
  const [seasonality, setSeasonality] = useState<SeasonalityRow[]>([]);
  const [periodRankings, setPeriodRankings] = useState<PeriodEntityRankings | null>(null);
  const [airlineYearly, setAirlineYearly] = useState<{ international: AirlineYearRow[]; domestic: AirlineYearRow[] } | null>(null);
  const [monthlyBreakdown, setMonthlyBreakdown] = useState<MonthlyCell[]>([]);
  const [airlineMeta, setAirlineMeta] = useState<{ airlines: AirlineMeta[] } | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [trendsSegment, setTrendsSegment] = useState<Segment>("international");
  const [trendsYearRange, setTrendsYearRange] = useState<[number, number]>([DATA_YEAR_MIN, DATA_YEAR_MAX]);
  const [heatmapSegment, setHeatmapSegment] = useState<Segment>("international");
  const [heatmapAllYears, setHeatmapAllYears] = useState(true);
  const [heatmapPickerYear, setHeatmapPickerYear] = useState(DATA_YEAR_MAX - 1);
  const heatmapSelectedYear: number | "all" = heatmapAllYears ? "all" : heatmapPickerYear;
  const [cargoSegment, setCargoSegment] = useState<Segment>("international");
  const [cargoAllYears, setCargoAllYears] = useState(true);
  const [cargoAllMonths, setCargoAllMonths] = useState(true);
  const [cargoPickerYear, setCargoPickerYear] = useState(DATA_YEAR_MAX - 1);
  const [cargoPickerMonth, setCargoPickerMonth] = useState(1);
  const cargoPeriod = useMemo((): PeriodSelection => ({
    selectedYear: cargoAllYears ? "all" : cargoPickerYear,
    selectedMonth: cargoAllMonths ? "all" : cargoPickerMonth,
  }), [cargoAllYears, cargoPickerYear, cargoAllMonths, cargoPickerMonth]);
  const [duckReady, setDuckReady] = useState(false);
  const [duckLoading, setDuckLoading] = useState(false);
  const [duckConn, setDuckConn] = useState<unknown>(null);
  const [trendsKpis, setTrendsKpis] = useState<{ passengers: number; cargo: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [duckError, setDuckError] = useState<string | null>(null);
  const duckQueryLock = useRef(Promise.resolve());
  const duckInitAttempted = useRef(false);

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
  const trendsChartData = useMemo(() => buildChartData(trendsFiltered, trendsSegment), [trendsFiltered, trendsSegment, buildChartData]);
  const cargoChart = useMemo(
    () => buildCargoChartData(trends, seasonality, cargoSegment, cargoPeriod),
    [trends, seasonality, cargoSegment, cargoPeriod],
  );
  const trendsJsonKpis = useMemo(() => ({
    passengers: trendsFiltered.reduce((s, t) => s + t.passengers, 0),
    cargo: trendsFiltered.reduce((s, t) => s + t.cargo_tons, 0),
  }), [trendsFiltered]);

  useEffect(() => {
    Promise.all([
      fetch("/data/aviation/summary.json").then((r) => r.json()),
      fetch("/data/aviation/yearly-trends.json").then((r) => r.json()),
      fetch("/data/aviation/monthly-seasonality.json").then((r) => r.json()),
      fetch("/data/aviation/insights.json").then((r) => r.json()),
      fetch("/data/aviation/period-entity-rankings.json").then((r) => r.json()),
      fetch("/data/aviation/airline-yearly-passengers.json").then((r) => r.json()),
      fetch("/data/aviation/monthly-airline-breakdown.json").then((r) => r.json()),
      fetch("/data/aviation/airline-metadata.json").then((r) => r.json()),
    ]).then(([s, t, seas, ins, period, aly, monthly, meta]) => {
      setSummary(s);
      setTrends(t);
      setSeasonality(seas);
      setInsights(ins.findings);
      setPeriodRankings(period);
      setAirlineYearly(aly);
      setMonthlyBreakdown(monthly);
      setAirlineMeta(meta);
      setLoadError(null);
    }).catch((err) => {
      console.error("Dashboard data load failed:", err);
      setLoadError("Could not load aviation data files. Try refreshing the page.");
    });
  }, []);

  const runDuckQuery = useCallback((task: () => Promise<void>) => {
    duckQueryLock.current = duckQueryLock.current
      .then(task)
      .catch((err) => console.error("DuckDB query failed:", err));
  }, []);

  const queryTrendsKpis = useCallback(async (
    segment: Segment,
    yearRange: [number, number],
    onKpis: (k: { passengers: number; cargo: number }) => void,
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
  }, [duckConn, duckReady]);

  const initDuckDB = useCallback(async () => {
    if (duckReady || duckInitAttempted.current) return;
    duckInitAttempted.current = true;
    setDuckLoading(true);
    setDuckError(null);
    try {
      const duckdb = await import("@duckdb/duckdb-wasm");
      const bundles = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(bundles);
      const worker = new Worker(bundle.mainWorker!);
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? undefined);
      const conn = await db.connect();
      const res = await fetch("/data/aviation/traffic.parquet");
      if (!res.ok) throw new Error(`Parquet fetch failed (${res.status})`);
      const buf = new Uint8Array(await res.arrayBuffer());
      await db.registerFileBuffer("traffic.parquet", buf);
      await conn.query("CREATE TABLE traffic AS SELECT * FROM read_parquet('traffic.parquet')");
      setDuckConn(conn);
      setDuckReady(true);
    } catch (e) {
      console.error("DuckDB init failed:", e);
      setDuckError("Live SQL unavailable — using cached JSON data.");
    } finally {
      setDuckLoading(false);
    }
  }, [duckReady]);

  useEffect(() => {
    const el = document.getElementById("aviation-dashboard");
    if (!el) return;
    const timer = window.setTimeout(() => { void initDuckDB(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [initDuckDB]);

  useEffect(() => {
    if (!duckReady) return;
    runDuckQuery(() => queryTrendsKpis(trendsSegment, trendsYearRange, setTrendsKpis));
  }, [duckReady, queryTrendsKpis, trendsSegment, trendsYearRange, runDuckQuery]);

  const exportCsv = async (segment: Segment, yearRange: [number, number]) => {
    if (!duckConn) return;
    const segFilter = segment === "all" ? "" : `AND segment = '${segment}'`;
    const exportLimit = 50_000;
    const r = await (duckConn as { query: (sql: string) => Promise<{ toArray: () => Record<string, unknown>[] }> })
      .query(`SELECT year, month, airline, segment, passengers, cargo_tons FROM traffic WHERE year BETWEEN ${yearRange[0]} AND ${yearRange[1]} ${segFilter} LIMIT ${exportLimit}`);
    const rows = r.toArray();
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const lines = [
      headers.map(escapeCsvCell).join(","),
      ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(",")),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "aviation-export.csv";
    a.click();
    if (rows.length >= exportLimit) {
      window.alert(`Export capped at ${exportLimit.toLocaleString()} rows. Narrow the year range or segment for a complete extract.`);
    }
  };

  const displayTrendsKpis = trendsKpis ?? trendsJsonKpis;
  const metaMap = useMemo(() => buildMetaMap(airlineMeta), [airlineMeta]);
  const cargoPeriodLabel = formatPeriodLabel(cargoPeriod);

  const trendsChartFilters = (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Segment</p>
        <SegmentToggle value={trendsSegment} onChange={setTrendsSegment} />
      </div>
      <div>
        <p className="mb-2 font-data text-[10px] uppercase tracking-wider text-strip-muted">Year range</p>
        <YearRangeControl value={trendsYearRange} onChange={setTrendsYearRange} />
      </div>
    </div>
  );

  if (loadError) {
    return <div className="dash-card border border-red-500/40 p-8 text-center font-data text-red-300">{loadError}</div>;
  }

  if (!summary) {
    return <div className="dash-card p-8 text-center font-data text-strip-muted">Loading dashboard data…</div>;
  }

  return (
    <div id="aviation-dashboard" className="space-y-8">
      {duckError && (
        <p className="rounded-lg border border-strip-warn/30 bg-strip-warn/10 px-4 py-2 font-data text-xs text-strip-warn">{duckError}</p>
      )}
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
          <p className="mt-2 font-data text-2xl font-semibold text-strip-text">{(summary.combined.rows ?? 173845).toLocaleString()}</p>
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
        filters={trendsChartFilters}
      >
        <StableChartContainer height={300}>
          {({ width, height }) => (
          <LineChart width={width} height={height} data={trendsChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" />
            <XAxis dataKey="year" tick={{ fill: "#a8bdd8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#a8bdd8", fontSize: 11 }} tickFormatter={formatNum} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={tooltipFormatter} />
            <Legend />
            {trendsSegment === "all" && (
              <>
                <Line type="monotone" dataKey="intlPax" name="International" stroke={CHART_COLORS.intl} dot={false} strokeWidth={2.5} isAnimationActive={false} />
                <Line type="monotone" dataKey="domPax" name="Domestic" stroke={CHART_COLORS.dom} dot={false} strokeWidth={2.5} isAnimationActive={false} />
              </>
            )}
            {trendsSegment === "international" && <Line type="monotone" dataKey="intlPax" name="International" stroke={CHART_COLORS.intl} dot={false} strokeWidth={2.5} isAnimationActive={false} />}
            {trendsSegment === "domestic" && <Line type="monotone" dataKey="domPax" name="Domestic" stroke={CHART_COLORS.dom} dot={false} strokeWidth={2.5} isAnimationActive={false} />}
          </LineChart>
          )}
        </StableChartContainer>
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
        filters={
          <HeatmapFilterControls
            segment={heatmapSegment}
            onSegmentChange={setHeatmapSegment}
            allYears={heatmapAllYears}
            onAllYearsChange={setHeatmapAllYears}
            year={heatmapPickerYear}
            onYearChange={setHeatmapPickerYear}
          />
        }
      >
        <Heatmap seasonality={seasonality} monthlyBreakdown={monthlyBreakdown} segment={heatmapSegment} selectedYear={heatmapSelectedYear} metaMap={metaMap} />
      </DashCard>

      <YearlyRankingsExplorer
        periodRankings={periodRankings}
        metaMap={metaMap}
        duckConn={duckConn}
        duckReady={duckReady}
      />

      <DashCard
        label="Cargo"
        title={`Cargo Trends (Metric Tons) — ${segmentLabel(cargoSegment)}`}
        description={cargoPeriodLabel}
        accent="warn"
        filters={
          <PeriodFilterControls
            segment={cargoSegment}
            onSegmentChange={setCargoSegment}
            allYears={cargoAllYears}
            onAllYearsChange={setCargoAllYears}
            year={cargoPickerYear}
            onYearChange={setCargoPickerYear}
            allMonths={cargoAllMonths}
            onAllMonthsChange={setCargoAllMonths}
            month={cargoPickerMonth}
            onMonthChange={setCargoPickerMonth}
          />
        }
      >
        <StableChartContainer height={260}>
          {({ width, height }) => (
          <BarChart width={width} height={height} data={cargoChart.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3054" />
            <XAxis dataKey={cargoChart.xKey} tick={{ fill: "#a8bdd8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#a8bdd8", fontSize: 11 }} tickFormatter={formatCargo} />
            <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={tooltipFormatter} />
            <Legend />
            {cargoSegment === "all" && (
              <>
                <Bar dataKey="intlCargo" name="Intl Cargo" fill={CHART_COLORS.intl} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="domCargo" name="Dom Cargo" fill={CHART_COLORS.dom} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </>
            )}
            {cargoSegment === "international" && <Bar dataKey="intlCargo" name="Intl Cargo" fill={CHART_COLORS.intl} radius={[3, 3, 0, 0]} isAnimationActive={false} />}
            {cargoSegment === "domestic" && <Bar dataKey="domCargo" name="Dom Cargo" fill={CHART_COLORS.dom} radius={[3, 3, 0, 0]} isAnimationActive={false} />}
          </BarChart>
          )}
        </StableChartContainer>
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
