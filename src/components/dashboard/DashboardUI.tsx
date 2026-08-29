import type { ReactNode } from "react";

export const DATA_YEAR_MIN = 2006;
export const DATA_YEAR_MAX = 2026;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type Segment = "international" | "domestic" | "all";

export const SEGMENT_ORDER: Segment[] = ["international", "domestic", "all"];

export const CHART_TOOLTIP_STYLE = {
  background: "rgba(14, 26, 48, 0.96)",
  border: "1px solid rgba(74, 144, 217, 0.35)",
  borderRadius: 8,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 12,
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

export function segmentLabel(segment: Segment): string {
  return segment === "all" ? "Combined" : segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function InactiveBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-block rounded border border-red-400/50 bg-red-500/20 font-data font-semibold uppercase tracking-wide text-red-300 ${
        compact ? "ml-1 px-1 py-px text-[7px]" : "ml-1.5 px-1.5 py-0.5 text-[9px]"
      }`}
    >
      Inactive
    </span>
  );
}

export function DashCard({
  label,
  title,
  description,
  children,
  accent = "accent",
  filters,
}: {
  label?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  accent?: "accent" | "signal" | "warn";
  filters?: ReactNode;
}) {
  const accentClass =
    accent === "signal" ? "from-strip-signal/40" : accent === "warn" ? "from-strip-warn/40" : "from-strip-accent/40";

  return (
    <div className="dash-card group">
      <div className={`dash-card-glow bg-gradient-to-r ${accentClass} to-transparent`} />
      {(label || title) && (
        <div className="mb-5">
          {label && <p className="strip-label">{label}</p>}
          {title && <h3 className="font-display text-lg font-bold tracking-tight text-strip-text">{title}</h3>}
          {description && <p className="mt-1.5 text-sm leading-relaxed text-strip-muted">{description}</p>}
        </div>
      )}
      {filters && <div className="filter-panel mb-5">{filters}</div>}
      {children}
    </div>
  );
}

export function SegmentToggle({ value, onChange }: { value: Segment; onChange: (s: Segment) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SEGMENT_ORDER.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`segment-btn ${value === s ? "segment-btn-active" : ""}`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function YearRangeControl({
  value,
  onChange,
  min = DATA_YEAR_MIN,
  max = DATA_YEAR_MAX,
}: {
  value: [number, number];
  onChange: (v: [number, number]) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-data text-xs text-strip-muted">
        <span>Start</span>
        <span className="rounded-md bg-strip-bg px-2 py-0.5 text-strip-accent">{value[0]}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value[0]}
        onChange={(e) => onChange([Math.min(+e.target.value, value[1]), value[1]])}
        className="range-slider w-full"
        aria-label="Start year"
      />
      <div className="flex items-center justify-between font-data text-xs text-strip-muted">
        <span>End</span>
        <span className="rounded-md bg-strip-bg px-2 py-0.5 text-strip-accent">{value[1]}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value[1]}
        onChange={(e) => onChange([value[0], Math.max(+e.target.value, value[0])])}
        className="range-slider w-full"
        aria-label="End year"
      />
    </div>
  );
}

export function YearPickerControl({
  allYears,
  onAllYearsChange,
  year,
  onYearChange,
  min = DATA_YEAR_MIN,
  max = DATA_YEAR_MAX,
}: {
  allYears: boolean;
  onAllYearsChange: (v: boolean) => void;
  year: number;
  onYearChange: (y: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onAllYearsChange(true)}
          className={`segment-btn flex-1 ${allYears ? "segment-btn-active" : ""}`}
        >
          All years
        </button>
        <button
          type="button"
          onClick={() => onAllYearsChange(false)}
          className={`segment-btn flex-1 ${!allYears ? "segment-btn-active" : ""}`}
        >
          One year
        </button>
      </div>
      {!allYears && (
        <>
          <div className="flex items-center justify-between font-data text-xs text-strip-muted">
            <span>Year</span>
            <span className="rounded-md bg-strip-bg px-2 py-0.5 text-strip-accent">
              {year}{(year === 2006 || year === 2026) ? " *" : ""}
            </span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            value={year}
            onChange={(e) => onYearChange(+e.target.value)}
            className="range-slider w-full"
            aria-label="Select year"
          />
        </>
      )}
    </div>
  );
}

export function MonthPickerControl({
  allMonths,
  onAllMonthsChange,
  month,
  onMonthChange,
}: {
  allMonths: boolean;
  onAllMonthsChange: (v: boolean) => void;
  month: number;
  onMonthChange: (m: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onAllMonthsChange(true)}
          className={`segment-btn flex-1 ${allMonths ? "segment-btn-active" : ""}`}
        >
          All months
        </button>
        <button
          type="button"
          onClick={() => onAllMonthsChange(false)}
          className={`segment-btn flex-1 ${!allMonths ? "segment-btn-active" : ""}`}
        >
          One month
        </button>
      </div>
      {!allMonths && (
        <>
          <div className="flex items-center justify-between font-data text-xs text-strip-muted">
            <span>Month</span>
            <span className="rounded-md bg-strip-bg px-2 py-0.5 text-strip-accent">{MONTHS[month - 1]}</span>
          </div>
          <input
            type="range"
            min={1}
            max={12}
            value={month}
            onChange={(e) => onMonthChange(+e.target.value)}
            className="range-slider w-full"
            aria-label="Select month"
          />
        </>
      )}
    </div>
  );
}

type AxisItem = { fullName: string; name: string };

export function AirlineYAxisTick({
  x = 0,
  y = 0,
  payload,
  items,
  metaMap,
  fontSize = 11,
  showInactive = true,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  items: AxisItem[];
  metaMap: Map<string, { inactive: boolean }>;
  fontSize?: number;
  showInactive?: boolean;
}) {
  const item = items.find((d) => d.name === payload?.value);
  const fullName = item?.fullName ?? payload?.value ?? "";
  const inactive = showInactive && metaMap.get(fullName)?.inactive;

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={-8}
        y={0}
        dy={4}
        textAnchor="end"
        fill="#c5d4e8"
        fontSize={fontSize}
        fontFamily="JetBrains Mono, monospace"
      >
        {payload?.value}
        {inactive && (
          <tspan fill="#f87171" fontSize={fontSize - 1} fontWeight={600}> · Inactive</tspan>
        )}
      </text>
    </g>
  );
}
