import type { ReportCase, ReportFile } from "./report.mts";

/**
 * Renders a report as a single self-contained HTML file.
 *
 * The data is inlined rather than fetched: a page opened over `file://` cannot read a sibling JSON,
 * and a file picker is friction when the point is to glance at a run (or screenshot it). Styling is
 * inline for the same reason — one file, double-click, done.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function pill(text: string, kind: "pass" | "fail" | "skip" | "muted"): string {
  return `<span class="pill ${kind}">${esc(text)}</span>`;
}

/** Tool names as a chain, marking the ones the approval gate paused. */
function renderTrajectory(trajectory: string[], interrupts: string[]): string {
  if (trajectory.length === 0) return `<span class="muted">no tools called</span>`;
  const paused = new Set(interrupts);
  return trajectory
    .map((name) => {
      const gated = paused.has(name);
      const title = gated ? ' title="paused for approval"' : "";
      return `<code class="tool${gated ? " gated" : ""}"${title}>${esc(name)}${gated ? " ⏸" : ""}</code>`;
    })
    .join('<span class="arrow">→</span>');
}

function renderRun(run: ReportCase["runs"][number], index: number, total: number): string {
  const label = total > 1 ? `run ${index + 1}` : "run";
  const graders = run.results
    .map(
      (r) =>
        `<li class="${r.passed ? "ok" : "bad"}"><code>${esc(r.graderId)}</code>` +
        (r.reason ? `<span class="reason">${esc(r.reason)}</span>` : "") +
        `</li>`,
    )
    .join("");

  return `
    <div class="run ${run.passed ? "ok" : "bad"}">
      <div class="run-head">
        <strong>${esc(label)}</strong>
        ${pill(run.passed ? "pass" : "fail", run.passed ? "pass" : "fail")}
        <div class="traj">${renderTrajectory(run.trajectory, run.interrupts)}</div>
      </div>
      ${run.error ? `<p class="error">threw: ${esc(run.error)}</p>` : ""}
      <ul class="graders">${graders}</ul>
      ${run.finalText ? `<details><summary>answer</summary><pre>${esc(run.finalText)}</pre></details>` : ""}
    </div>`;
}

function renderCase(c: ReportCase): string {
  const turns = Array.isArray(c.prompt) ? c.prompt : [c.prompt];
  const status = c.skipped ? "skip" : c.passed ? "pass" : "fail";
  const tags = (c.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");

  return `
    <section class="case ${status}" id="${esc(c.id)}">
      <header>
        <h2>${pill(status, status)} ${esc(c.id)}</h2>
        <div class="meta-row">
          ${c.runsAttempted > 1 ? `<span>${c.runsPassed}/${c.runsAttempted} runs</span>` : ""}
          ${c.approval ? `<span>approval: <code>${esc(c.approval)}</code></span>` : ""}
          ${turns.length > 1 ? `<span>${turns.length} turns</span>` : ""}
          ${tags}
        </div>
      </header>
      ${c.description ? `<p class="desc">${esc(c.description)}</p>` : ""}
      <details class="prompt">
        <summary>prompt${turns.length > 1 ? ` (${turns.length} turns)` : ""}</summary>
        ${turns.map((t, i) => `<pre>${turns.length > 1 ? `<span class="muted">turn ${i + 1}</span>\n` : ""}${esc(t)}</pre>`).join("")}
      </details>
      ${c.skipped ? `<p class="muted">skipped — not executed</p>` : c.runs.map((r, i) => renderRun(r, i, c.runs.length)).join("")}
    </section>`;
}

const STYLE = `
  :root { color-scheme: light dark; --bg:#fff; --fg:#1a1a1a; --muted:#6b7280; --line:#e5e7eb;
          --ok:#15803d; --bad:#b91c1c; --okbg:#f0fdf4; --badbg:#fef2f2; --code:#f6f8fa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --line:#30363d;
            --ok:#3fb950; --bad:#f85149; --okbg:#0f2417; --badbg:#2b1113; --code:#161b22; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); color:var(--fg);
         font:17px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width: 62rem; margin: 0 auto; }
  code, pre { font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  h1 { font-size:1.5rem; margin:0 0 .35rem; }
  h2 { font-size:1.08rem; margin:0; font-family:ui-monospace,monospace; font-weight:600; }
  .sub { color:var(--muted); font-size:.92rem; margin:0 0 1.5rem; }
  .sub code { background:var(--code); padding:.1rem .35rem; border-radius:4px; }
  .summary { display:flex; gap:.5rem; align-items:baseline; margin-bottom:1.5rem; flex-wrap:wrap; }
  .score { font-size:2.2rem; font-weight:700; }
  .pill { font-size:.76rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em;
          padding:.15rem .45rem; border-radius:4px; }
  .pill.pass { background:var(--okbg); color:var(--ok); }
  .pill.fail { background:var(--badbg); color:var(--bad); }
  .pill.skip, .pill.muted { background:var(--code); color:var(--muted); }
  .case { border:1px solid var(--line); border-left-width:3px; border-radius:8px;
          padding:1rem 1.1rem; margin-bottom:1rem; }
  .case.pass { border-left-color:var(--ok); }
  .case.fail { border-left-color:var(--bad); }
  .case.skip { border-left-color:var(--muted); opacity:.7; }
  .case header { display:flex; flex-direction:column; gap:.35rem; }
  .meta-row { display:flex; gap:.6rem; flex-wrap:wrap; color:var(--muted); font-size:.88rem;
              align-items:center; }
  .tag { background:var(--code); padding:.12rem .45rem; border-radius:4px; font-size:.8rem; }
  .desc { color:var(--muted); font-size:.95rem; margin:.5rem 0 .75rem; }
  .run { border-top:1px solid var(--line); padding-top:.75rem; margin-top:.75rem; }
  .run-head { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; font-size:.94rem; }
  .traj { display:flex; gap:.3rem; align-items:center; flex-wrap:wrap; margin-left:auto; }
  .tool { background:var(--code); padding:.12rem .45rem; border-radius:4px; font-size:.86rem; }
  .tool.gated { background:var(--okbg); color:var(--ok); }
  .arrow { color:var(--muted); font-size:.85rem; }
  ul.graders { list-style:none; margin:.7rem 0 0; padding:0; font-size:.92rem; }
  ul.graders li { padding:.2rem 0 .2rem 1.25rem; position:relative; }
  ul.graders li::before { position:absolute; left:0; }
  ul.graders li.ok::before { content:"✓"; color:var(--ok); }
  ul.graders li.bad::before { content:"✗"; color:var(--bad); }
  ul.graders li.bad code { color:var(--bad); }
  .reason { color:var(--muted); display:block; padding-left:.1rem; font-size:.88rem; }
  .error { color:var(--bad); font-size:.9rem; margin:.4rem 0; }
  details { margin-top:.6rem; font-size:.92rem; }
  summary { cursor:pointer; color:var(--muted); }
  pre { background:var(--code); padding:.6rem .7rem; border-radius:6px; overflow-x:auto;
        white-space:pre-wrap; word-break:break-word; font-size:.88rem; line-height:1.5;
        margin:.45rem 0 0; }
  .muted { color:var(--muted); }
`;

/** The report as a standalone page — no external requests, no build step. */
export function renderHtml(report: ReportFile): string {
  const { meta, cases } = report;
  const allPassed = meta.passed === meta.graded;
  const when = new Date(meta.timestamp).toLocaleString();
  const fastWarning =
    meta.mode === "fast" ? ` <span class="pill muted">fast — one run per case</span>` : "";

  return `<!doctype html>
<meta charset="utf-8">
<title>Cameron evals — ${esc(meta.passed)}/${esc(meta.graded)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${STYLE}</style>
<main>
  <h1>Cameron evals</h1>
  <p class="sub"><code>${esc(meta.provider)} / ${esc(meta.model)}</code> · ${esc(when)}${fastWarning}</p>
  <div class="summary">
    <span class="score" style="color:${allPassed ? "var(--ok)" : "var(--bad)"}">${esc(meta.passed)}/${esc(meta.graded)}</span>
    <span class="muted">cases passed${meta.skipped ? ` · ${esc(meta.skipped)} skipped` : ""}</span>
  </div>
  ${[...cases]
    .sort((a, b) => Number(a.passed) - Number(b.passed))
    .map(renderCase)
    .join("")}
</main>
`;
}
