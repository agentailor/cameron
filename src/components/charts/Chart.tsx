"use client";

import { useId, useState } from "react";
import { buildModel, ticks, yScale } from "./geometry";
import { seriesColor, type ChartPayload } from "./types";

/**
 * A chart, drawn as plain SVG from a frozen payload.
 *
 * No charting library: the mark specs (capped bar width, rounded data-end, 2px surface gaps,
 * surface rings, recessive hairline axes) are specific enough that wrapping a library to obey them
 * is more code than drawing them, and a library brings its own styling system to fight the tokens.
 *
 * Colors come from --chart-N, which are CATEGORICAL (one hue per slot, fixed order). They are
 * deliberately not amber: amber marks the approval boundary in this app and nothing else.
 */

const H = 200; // plot height
const PAD_L = 52; // room for y labels
const PAD_B = 34; // room for x labels
const PAD_T = 8;
const BAR_MAX = 24; // never fill the band — the leftover is air
const GAP = 2; // the surface gap that separates touching marks

function formatTick(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}k`;
  return String(Math.round(n * 100) / 100);
}

interface Hover {
  label: string;
  rows: { key: string; value: number | null; color: string }[];
  xPct: number;
}

export function Chart({ payload, width = 640 }: { payload: ChartPayload; width?: number }) {
  const model = buildModel(payload);
  const [hover, setHover] = useState<Hover | null>(null);
  const clipId = useId();

  if (model.isEmpty) {
    return (
      <figure className="border-border bg-background rounded-lg border p-6">
        <Caption payload={payload} />
        <p className="text-muted-foreground py-8 text-center text-sm">
          No data to chart for this query.
        </p>
      </figure>
    );
  }

  const plotW = width - PAD_L;
  const band = plotW / Math.max(model.categories.length, 1);
  const multi = model.series.length > 1;
  const zeroY = yScale(0, model, H);

  const hoverAt = (i: number) =>
    setHover({
      label: model.categories[i],
      rows: model.series.map((s, si) => ({
        key: s.key,
        value: s.points[i]?.y ?? null,
        color: seriesColor(si),
      })),
      xPct: ((PAD_L + band * (i + 0.5)) / width) * 100,
    });

  return (
    <figure className="border-border bg-background relative rounded-lg border p-4">
      <Caption payload={payload} />

      {multi && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
          {model.series.map((s, i) => (
            <li key={s.key} className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ background: seriesColor(i) }}
              />
              {s.key}
            </li>
          ))}
        </ul>
      )}

      <svg
        width="100%"
        viewBox={`0 0 ${width} ${H + PAD_T + PAD_B}`}
        role="img"
        aria-label={payload.spec.title ?? `${payload.spec.chartType} chart`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD_L} y={0} width={plotW} height={H + PAD_T} />
          </clipPath>
        </defs>

        {/* Gridlines + y labels: hairline, solid, recessive — never dashed. */}
        {ticks(model).map((t) => {
          const y = yScale(t, model, H) + PAD_T;
          return (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={width}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={PAD_L - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {formatTick(t)}
              </text>
            </g>
          );
        })}

        <g clipPath={`url(#${clipId})`}>
          {payload.spec.chartType === "bar"
            ? model.series.map((s, si) =>
                s.points.map((p, i) => {
                  if (p.y === null) return null;
                  const slot = band / model.series.length;
                  const w = Math.min(BAR_MAX, Math.max(slot - GAP * 2, 2));
                  const x = PAD_L + band * i + slot * si + (slot - w) / 2;
                  const yv = yScale(p.y, model, H) + PAD_T;
                  const top = Math.min(yv, zeroY + PAD_T);
                  const h = Math.max(Math.abs(yv - (zeroY + PAD_T)), 1);
                  return (
                    <rect
                      key={`${s.key}-${p.x}`}
                      x={x}
                      y={top}
                      width={w}
                      height={h}
                      rx={4}
                      fill={seriesColor(si)}
                      onMouseEnter={() => hoverAt(i)}
                    />
                  );
                }),
              )
            : model.series.map((s, si) => {
                // Split on nulls so a gap breaks the line instead of interpolating through it.
                const segs: { x: number; y: number }[][] = [];
                let cur: { x: number; y: number }[] = [];
                s.points.forEach((p, i) => {
                  if (p.y === null) {
                    if (cur.length) segs.push(cur);
                    cur = [];
                    return;
                  }
                  cur.push({
                    x: PAD_L + band * (i + 0.5),
                    y: yScale(p.y, model, H) + PAD_T,
                  });
                });
                if (cur.length) segs.push(cur);

                return (
                  <g key={s.key}>
                    {segs.map((seg, k) => (
                      <path
                        key={k}
                        d={seg.map((pt, j) => `${j ? "L" : "M"}${pt.x},${pt.y}`).join(" ")}
                        fill="none"
                        stroke={seriesColor(si)}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {/* A lone point would be an invisible zero-length path. */}
                    {segs
                      .filter((seg) => seg.length === 1)
                      .map((seg, k) => (
                        <circle
                          key={`dot-${k}`}
                          cx={seg[0].x}
                          cy={seg[0].y}
                          r={4}
                          fill={seriesColor(si)}
                          stroke="var(--background)"
                          strokeWidth={2}
                        />
                      ))}
                  </g>
                );
              })}
        </g>

        {/* Zero line, drawn over the grid when the domain crosses it. */}
        {model.yMin < 0 && model.yMax > 0 && (
          <line
            x1={PAD_L}
            x2={width}
            y1={zeroY + PAD_T}
            y2={zeroY + PAD_T}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        )}

        {/* x labels, thinned so they never collide. */}
        {model.categories.map((c, i) => {
          const every = Math.ceil((model.categories.length * 58) / plotW);
          if (i % every !== 0) return null;
          return (
            <text
              key={c}
              x={PAD_L + band * (i + 0.5)}
              y={H + PAD_T + 18}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted-foreground)"
            >
              {c.length > 12 ? `${c.slice(0, 11)}…` : c}
            </text>
          );
        })}

        {/* Invisible hover bands — a hit target bigger than the mark. */}
        {model.categories.map((c, i) => (
          <rect
            key={`hit-${c}`}
            x={PAD_L + band * i}
            y={0}
            width={band}
            height={H + PAD_T}
            fill="transparent"
            onMouseEnter={() => hoverAt(i)}
          />
        ))}
      </svg>

      {hover && (
        <div
          className="border-border bg-popover pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: `${hover.xPct}%` }}
        >
          <div className="text-foreground mb-0.5 font-medium">{hover.label}</div>
          {hover.rows.map((r) => (
            <div key={r.key} className="text-muted-foreground flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: r.color }}
              />
              {multi && <span>{r.key}:</span>}
              <span className="text-foreground tabular-nums">
                {r.value === null ? "—" : formatTick(r.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

function Caption({ payload }: { payload: ChartPayload }) {
  const { title, subtitle } = payload.spec;
  if (!title && !subtitle) return null;
  return (
    <figcaption className="mb-3">
      {title && <div className="text-foreground text-sm font-semibold">{title}</div>}
      {subtitle && <div className="text-muted-foreground text-xs">{subtitle}</div>}
    </figcaption>
  );
}
