// Shared helpers, status definitions, filter engine, icons.

const STATUSES = [
  { key: "open",        glyph: "[ ]", label: "Open" },
  { key: "in-progress", glyph: "[/]", label: "In progress" },
  { key: "blocked",     glyph: "[!]", label: "Blocked" },
  { key: "postponed",   glyph: "[>]", label: "Postponed" },
  { key: "done",        glyph: "[x]", label: "Done" },
  { key: "cancelled",   glyph: "[-]", label: "Cancelled" }
];
const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(s => [s.key, s]));
const STATUS_ORDER = STATUSES.map(s => s.key);

const PRIORITIES = ["P0", "P1", "P2", "P3"];

// ---- date helpers ----
function parseDate(s) { return s ? new Date(s + "T12:00:00Z") : null; }
function daysBetween(a, b) { return Math.round((a - b) / 86400000); }
function isOverdue(item) {
  if (!item.due || item.status === "done" || item.status === "cancelled") return false;
  return parseDate(item.due) < new Date();
}
function dueRelative(item) {
  if (!item.due) return null;
  const d = daysBetween(parseDate(item.due), new Date());
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 7) return `in ${d}d`;
  if (d < 30) return `in ${Math.round(d/7)}w`;
  return item.due;
}
function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d    = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)       return "just now";
  if (diff < 3600)     return `${Math.round(diff/60)}m ago`;
  if (diff < 86400)    return `${Math.round(diff/3600)}h ago`;
  if (diff < 86400*7)  return `${Math.round(diff/86400)}d ago`;
  return d.toISOString().slice(0, 10);
}
function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1024/1024).toFixed(2)} MB`;
}
const fmtRelative = fmtTimestamp;
function fmtShortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ---- tree helpers ----
function walkTree(items, fn, depth = 0, parent = null) {
  for (const it of items) {
    fn(it, depth, parent);
    if (it.children?.length) walkTree(it.children, fn, depth + 1, it);
  }
}
function findItem(items, id) {
  for (const it of items) {
    if (it.id === id) return it;
    if (it.children?.length) {
      const f = findItem(it.children, id);
      if (f) return f;
    }
  }
  return null;
}
function allTags(items) {
  const counts = new Map();
  walkTree(items, it => (it.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
function countAll(items) {
  let n = 0; walkTree(items, () => n++); return n;
}
function countByStatus(items) {
  const c = Object.fromEntries(STATUSES.map(s => [s.key, 0]));
  walkTree(items, it => { c[it.status] = (c[it.status] || 0) + 1; });
  return c;
}

// ---- filter engine with parent-visibility rule ----
function filterTree(items, f) {
  function matches(it) {
    if (f.statuses?.length && !f.statuses.includes(it.status)) return false;
    if (f.priorities?.length && !f.priorities.includes(it.priority)) return false;
    if (f.tags?.length && !(it.tags || []).some(t => f.tags.includes(t))) return false;
    if (f.dueRange) {
      const overdue = isOverdue(it);
      const d = it.due ? daysBetween(parseDate(it.due), new Date()) : null;
      if (f.dueRange === "overdue" && !overdue) return false;
      if (f.dueRange === "today"   && !(d === 0)) return false;
      if (f.dueRange === "week"    && !(d !== null && d >= 0 && d <= 7)) return false;
      if (f.dueRange === "month"   && !(d !== null && d >= 0 && d <= 30)) return false;
    }
    if (f.text) {
      const q = f.text.toLowerCase();
      const hay = [it.title, it.reason, ...(it.tags || [])].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }
  function recur(list) {
    const out = [];
    for (const it of list) {
      const kids = it.children?.length ? recur(it.children) : [];
      const self = matches(it);
      if (self || kids.length) {
        out.push({ ...it, children: kids, _matches: self });
      }
    }
    return out;
  }
  return recur(items);
}

// ---- status visuals (4 styles, switchable via Tweaks) ----
// styles: "flat" (minimal monochrome SVG, inherits status color),
//         "ascii" (original [/], [x] etc),
//         "color" (filled colored icons, ChatGPT-style — green check, red blocked, etc),
//         "emoji" (expressive native emoji — ✅ 🚧 ⏸ etc)

// Self-contained color palette for the "color" style — does NOT inherit currentColor.
const STATUS_COLORS = {
  "open":        { stroke: "oklch(0.62 0.01 70)",  fill: "transparent" },
  "in-progress": { stroke: "oklch(0.55 0.16 230)", fill: "oklch(0.62 0.16 230)" },
  "blocked":     { stroke: "oklch(0.50 0.20 28)",  fill: "oklch(0.62 0.20 28)"  },
  "postponed":   { stroke: "oklch(0.55 0.13 290)", fill: "oklch(0.65 0.13 290)" },
  "done":        { stroke: "oklch(0.48 0.16 145)", fill: "oklch(0.60 0.16 145)" },
  "cancelled":   { stroke: "oklch(0.55 0.01 70)",  fill: "oklch(0.65 0.01 70)"  },
};

// Expressive emoji pack — chosen for clarity at small sizes (avoid round colored dots).
const STATUS_EMOJI = {
  "open":        "⬜",
  "in-progress": "✏️",
  "blocked":     "🚧",
  "postponed":   "⏸️",
  "done":        "✅",
  "cancelled":   "❌",
};

// Context so every StatusIcon in the tree picks up the current style automatically.
const StatusStyleContext = React.createContext("flat");

function StatusIcon({ status, style, size = 14 }) {
  const ctx = React.useContext(StatusStyleContext);
  style = style || ctx || "flat";
  if (style === "ascii") {
    return <span className={`glyph-ascii status-${status}`}>{STATUS_BY_KEY[status].glyph}</span>;
  }
  if (style === "color") {
    return <ColorStatusIcon status={status} size={size}/>;
  }
  if (style === "emoji") {
    return <span className="glyph-emoji" style={{ fontSize: size + 2, lineHeight: 1 }}>{STATUS_EMOJI[status]}</span>;
  }
  // flat — minimalistic SVG icons (square family, no circles)
  const c = "currentColor";
  const wrap = (children) => (
    <svg width={size + 2} height={size + 2} viewBox="0 0 16 16" className={`glyph-flat status-${status}`}>
      {children}
    </svg>
  );
  switch (status) {
    case "open":
      // empty square outline
      return wrap(<rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke={c} strokeWidth="1.4"/>);
    case "in-progress":
      // half-filled square (left filled)
      return wrap(<>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke={c} strokeWidth="1.4"/>
        <path d="M3.5 3.5 H8 V12.5 H3.5 Z" fill={c}/>
      </>);
    case "blocked":
      // filled square with horizontal bar (no entry)
      return wrap(<>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill={c}/>
        <rect x="4.5" y="7.2" width="7" height="1.6" rx="0.5" fill="white"/>
      </>);
    case "postponed":
      // square with right-pointing chevron (deferred)
      return wrap(<>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke={c} strokeWidth="1.4"/>
        <polyline points="6,5.5 9,8 6,10.5" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </>);
    case "done":
      // filled square with checkmark
      return wrap(<>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill={c}/>
        <polyline points="5,8 7,10.2 11,5.8" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      </>);
    case "cancelled":
      // outlined square with single clean diagonal slash
      return wrap(<>
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke={c} strokeWidth="1.4"/>
        <line x1="3.5" y1="12.5" x2="12.5" y2="3.5" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
      </>);
    default: return null;
  }
}

// ---- color status icons (ChatGPT / Linear / GitHub style) ----
// Filled circles with semantic colors and white glyphs. Self-coloring,
// not affected by currentColor — looks good on any background.
function ColorStatusIcon({ status, size = 14 }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.open;
  const w = size + 2;
  const cx = 8, cy = 8, r = 6.4;

  switch (status) {
    case "open":
      // empty circle — thin gray ring
      return (
        <svg width={w} height={w} viewBox="0 0 16 16" className={`glyph-color status-${status}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={c.stroke} strokeWidth="1.5"/>
        </svg>
      );

    case "in-progress":
      // half-filled pie (clockwise 50%) — Linear-style "in progress"
      return (
        <svg width={w} height={w} viewBox="0 0 16 16" className={`glyph-color status-${status}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={c.fill} strokeWidth="1.5"/>
          <path d={`M 8 1.6 A 6.4 6.4 0 0 1 8 14.4 Z`} fill={c.fill}/>
        </svg>
      );

    case "blocked":
      // red filled circle with white horizontal bar
      return (
        <svg width={w} height={w} viewBox="0 0 16 16" className={`glyph-color status-${status}`}>
          <circle cx={cx} cy={cy} r={r} fill={c.fill}/>
          <rect x="4.6" y="7.2" width="6.8" height="1.6" rx="0.8" fill="white"/>
        </svg>
      );

    case "postponed":
      // purple filled circle with white right-chevron
      return (
        <svg width={w} height={w} viewBox="0 0 16 16" className={`glyph-color status-${status}`}>
          <circle cx={cx} cy={cy} r={r} fill={c.fill}/>
          <polyline points="6.4,5.4 9.4,8 6.4,10.6" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );

    case "done":
      // green filled circle with white check
      return (
        <svg width={w} height={w} viewBox="0 0 16 16" className={`glyph-color status-${status}`}>
          <circle cx={cx} cy={cy} r={r} fill={c.fill}/>
          <polyline points="5,8.2 7.2,10.3 11,5.9" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );

    case "cancelled":
      // gray filled circle with white X
      return (
        <svg width={w} height={w} viewBox="0 0 16 16" className={`glyph-color status-${status}`}>
          <circle cx={cx} cy={cy} r={r} fill={c.fill}/>
          <g stroke="white" strokeWidth="1.6" strokeLinecap="round">
            <line x1="5.6" y1="5.6" x2="10.4" y2="10.4"/>
            <line x1="10.4" y1="5.6" x2="5.6" y2="10.4"/>
          </g>
        </svg>
      );
    default: return null;
  }
}

// ---- icons (inline SVG) ----
const Icon = ({ name, size = 14 }) => {
  const paths = {
    chevron: <polyline points="5,8 10,13 15,8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>,
    chevronRight: <polyline points="8,5 13,10 8,15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>,
    plus: <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></g>,
    search: <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="9" cy="9" r="5"/><line x1="13" y1="13" x2="17" y2="17"/></g>,
    drag: <g fill="currentColor"><circle cx="7" cy="5" r="1.2"/><circle cx="13" cy="5" r="1.2"/><circle cx="7" cy="10" r="1.2"/><circle cx="13" cy="10" r="1.2"/><circle cx="7" cy="15" r="1.2"/><circle cx="13" cy="15" r="1.2"/></g>,
    trash: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 6h10M8 6V4h4v2M6 6l1 10h6l1-10"/></g>,
    cog: <g fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="2.6"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/></g>,
    list: <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="6" y1="6" x2="16" y2="6"/><line x1="6" y1="10" x2="16" y2="10"/><line x1="6" y1="14" x2="16" y2="14"/><circle cx="3.5" cy="6" r="0.6" fill="currentColor"/><circle cx="3.5" cy="10" r="0.6" fill="currentColor"/><circle cx="3.5" cy="14" r="0.6" fill="currentColor"/></g>,
    check: <polyline points="4,10 8,14 16,5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>,
    download: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v10M5 9l5 5 5-5M3 17h14"/></g>,
    upload: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 16V4M5 9l5-5 5 5M3 17h14"/></g>,
    save: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M4 4h9l3 3v9H4z"/><path d="M7 4v4h6V4M7 16v-5h6v5"/></g>,
    refresh: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10a7 7 0 0 1 12-5l2 2"/><path d="M17 4v3h-3"/><path d="M17 10a7 7 0 0 1-12 5l-2-2"/><path d="M3 16v-3h3"/></g>,
    warn: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3l8 14H2z"/><line x1="10" y1="8" x2="10" y2="12"/><circle cx="10" cy="14.5" r="0.6" fill="currentColor"/></g>,
    eye: <g fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2"/></g>,
    archive: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="3" y="5" width="14" height="3"/><path d="M4 8v9h12V8"/><line x1="8" y1="11" x2="12" y2="11"/></g>,
    edit: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14v2h2l8-8-2-2-8 8z"/><path d="M12 4l2 2"/></g>,
    addChild: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4v6a3 3 0 0 0 3 3h4"/><line x1="14" y1="13" x2="14" y2="17"/><line x1="12" y1="15" x2="16" y2="15"/></g>,
    copy: <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="3" width="10" height="12" rx="1.5"/><path d="M13 17H4a1 1 0 0 1-1-1V6"/></g>,
    statusDots: <g fill="currentColor"><circle cx="5" cy="10" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="15" cy="10" r="1.6"/></g>
  };
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}>
      {paths[name]}
    </svg>
  );
};

// --- Progress (completion %) ---
// Quantized to 0/25/50/75/100 — coarse on purpose; tasks are rarely "73% done".
const PROGRESS_STEPS = [0, 25, 50, 75, 100];
function snapProgress(p) {
  if (p == null || isNaN(p)) return 0;
  if (p <= 0) return 0;
  if (p >= 100) return 100;
  // round to nearest 25
  return Math.round(p / 25) * 25;
}
// Effective progress: done is always 100 regardless of stored value;
// cancelled returns null (don't render).
function progressFor(item) {
  if (item.status === "done") return 100;
  if (item.status === "cancelled") return null;
  return snapProgress(item.progress ?? 0);
}
// When progress should be visible inline. Done shows nothing (line-through is enough).
// Open shows only if user explicitly set >0.
function shouldShowProgress(item) {
  if (item.status === "cancelled") return false;
  if (item.status === "done") return false;
  if (item.status === "open") return (item.progress ?? 0) > 0;
  return true; // in-progress, blocked, postponed (always visible, including at 100%)
}
// Click to advance through 0/25/50/75/100, wrapping.
function cycleProgress(p) {
  const i = PROGRESS_STEPS.indexOf(snapProgress(p));
  return PROGRESS_STEPS[(i + 1) % PROGRESS_STEPS.length];
}

// 4-segment gauge (visual representation of 0/25/50/75/100).
// 0 = empty, 100 = all 4 filled.
function ProgressGauge({ value, onClick, interactive = false, size = "sm" }) {
  const v = snapProgress(value);
  const filled = v / 25; // 0..4
  const segs = [0, 1, 2, 3].map(i => i < filled);
  return (
    <span
      className={`gauge ${interactive ? "gauge-interactive" : ""} gauge-${size} gauge-v-${v}`}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={`${v}% complete${interactive ? " — click to change" : ""}`}
      aria-label={`Progress ${v} percent`}
    >
      {segs.map((on, i) => (
        <span key={i} className={`gauge-seg ${on ? "on" : ""}`}/>
      ))}
      <span className="gauge-num">{v}%</span>
    </span>
  );
}

Object.assign(window, {
  STATUSES, STATUS_BY_KEY, STATUS_ORDER, PRIORITIES,
  parseDate, daysBetween, isOverdue, dueRelative, fmtTimestamp, fmtBytes, fmtRelative, fmtShortDate,
  walkTree, findItem, allTags, countAll, countByStatus, filterTree,
  Icon, StatusIcon, ColorStatusIcon, STATUS_COLORS, STATUS_EMOJI, StatusStyleContext,
  PROGRESS_STEPS, snapProgress, progressFor, shouldShowProgress, cycleProgress, ProgressGauge
});
