// Admin / Maintenance page: health, storage stats, backup browser, stats, manual actions.

// ---- Range-aware stats engine -----------------------------------------------
// Generates deterministic per-bucket counts based on seed numbers so switching
// range feels real (each range animates between fixed shapes, not random noise).
const RANGE_OPTIONS = [
  { key: "week",   label: "This week",  buckets: 7,  bucketLabel: "d", granularity: "day" },
  { key: "month",  label: "This month", buckets: 5,  bucketLabel: "w", granularity: "week" },
  { key: "year",   label: "This year",  buckets: 12, bucketLabel: "m", granularity: "month" },
  { key: "7d",     label: "Last 7d",    buckets: 7,  bucketLabel: "d", granularity: "day" },
  { key: "30d",    label: "Last 30d",   buckets: 30, bucketLabel: "d", granularity: "day" },
  { key: "365d",   label: "Last 365d",  buckets: 12, bucketLabel: "m", granularity: "month" },
];

// Returns [{start, end}] bucket boundaries matching bucketLabelsFor(rangeKey)
function bucketBounds(rangeKey, refDate) {
  const d = new Date(refDate);
  if (rangeKey === 'week') {
    const dow = (d.getDay() + 6) % 7;
    const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
    return Array.from({length: 7}, (_, i) => {
      const s = new Date(mon); s.setDate(mon.getDate() + i);
      const e = new Date(s);  e.setDate(s.getDate() + 1);
      return { start: s, end: e };
    });
  }
  if (rangeKey === '7d') {
    return Array.from({length: 7}, (_, i) => {
      const offset = 6 - i;
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
      const e = new Date(s); e.setDate(s.getDate() + 1);
      return { start: s, end: e };
    });
  }
  if (rangeKey === '30d') {
    return Array.from({length: 30}, (_, i) => {
      const offset = 29 - i;
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
      const e = new Date(s); e.setDate(s.getDate() + 1);
      return { start: s, end: e };
    });
  }
  if (rangeKey === 'month') {
    const y = d.getFullYear(), mo = d.getMonth();
    return Array.from({length: 5}, (_, i) => ({
      start: new Date(y, mo, 1 + i * 7),
      end:   i < 4 ? new Date(y, mo, 1 + (i + 1) * 7) : new Date(y, mo + 1, 1),
    }));
  }
  if (rangeKey === 'year') {
    const y = d.getFullYear();
    return Array.from({length: 12}, (_, i) => ({
      start: new Date(y, i, 1),
      end:   new Date(y, i + 1, 1),
    }));
  }
  if (rangeKey === '365d') {
    return Array.from({length: 12}, (_, i) => {
      const offset = 11 - i;
      const y = d.getFullYear(), mo = d.getMonth();
      return {
        start: new Date(y, mo - offset, 1),
        end:   new Date(y, mo - offset + 1, 1),
      };
    });
  }
  return [];
}

function countInBuckets(history, buckets) {
  const keys = ['created', 'in-progress', 'blocked', 'postponed', 'done', 'cancelled'];
  const out = Object.fromEntries(keys.map(k => [k, Array(buckets.length).fill(0)]));
  for (const h of history) {
    const ts  = new Date(h.timestamp);
    const idx = buckets.findIndex(b => ts >= b.start && ts < b.end);
    if (idx < 0) continue;
    if (h.action === 'item_created') {
      out.created[idx]++;
    } else if (h.action === 'status_changed') {
      const m = h.details.match(/→\s*(\S[\s\S]*?)$/);
      if (m) {
        const ns = m[1].trim();
        if (ns in out) out[ns][idx]++;
      }
    }
  }
  return out;
}

function bucketLabelsFor(rangeKey) {
  const today = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  if (rangeKey === "week") {
    return days;
  }
  if (rangeKey === "7d") {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      out.push(days[(d.getDay() + 6) % 7]);
    }
    return out;
  }
  if (rangeKey === "30d") {
    const out = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      out.push(String(d.getDate()));
    }
    return out;
  }
  if (rangeKey === "month") {
    return ["W1","W2","W3","W4","W5"];
  }
  if (rangeKey === "year") {
    return months;
  }
  if (rangeKey === "365d") {
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today); d.setMonth(today.getMonth() - i);
      out.push(months[d.getMonth()]);
    }
    return out;
  }
  return [];
}

// Status keys in the order we want them stacked (bottom → top).
// "created" is a synthetic bucket: items that entered the system in that period.
const CHART_STATUSES = [
  { key: "created",     label: "Created",     color: "oklch(0.78 0.13 220)" },  // sky cyan-blue
  { key: "in-progress", label: "In progress", color: "oklch(0.72 0.14 270)" },  // lavender
  { key: "blocked",     label: "Blocked",     color: "oklch(0.68 0.20 28)"  },  // red — fixed (0° HSL)
  { key: "postponed",   label: "Postponed",   color: "oklch(0.83 0.16 90)"  },  // bright golden yellow — bisector of red↔green (≈70° HSL)
  { key: "done",        label: "Done",        color: "oklch(0.68 0.16 150)" },  // green — fixed (140° HSL)
  { key: "cancelled",   label: "Cancelled",   color: "oklch(0.62 0.04 280)" },  // slate
];

function computeRangeStats(rangeKey, dataStats, history) {
  const opt    = RANGE_OPTIONS.find(r => r.key === rangeKey);
  const labels = bucketLabelsFor(rangeKey);
  const now    = new Date();

  // Prior-period reference: shift back by one equivalent period
  const priorRef = new Date(now);
  if      (rangeKey === 'week' || rangeKey === '7d')   priorRef.setDate(priorRef.getDate() - 7);
  else if (rangeKey === 'month' || rangeKey === '30d')  priorRef.setMonth(priorRef.getMonth() - 1);
  else if (rangeKey === 'year'  || rangeKey === '365d') priorRef.setFullYear(priorRef.getFullYear() - 1);

  const curr  = countInBuckets(history, bucketBounds(rangeKey, now));
  const prior = countInBuckets(history, bucketBounds(rangeKey, priorRef));

  const series = {
    created:        curr.created,
    'in-progress':  curr['in-progress'],
    blocked:        curr.blocked,
    postponed:      curr.postponed,
    done:           curr.done,
    cancelled:      curr.cancelled,
  };

  const sum            = arr => arr.reduce((a, b) => a + b, 0);
  const totalCreated   = sum(curr.created);
  const totalCompleted = sum(curr.done);
  const priorCreated   = sum(prior.created);
  const priorCompleted = sum(prior.done);

  const pct = (c, p) => p === 0 ? (c > 0 ? 100 : 0) : Math.round(((c - p) / p) * 100);

  const periodWeeks     = { week: 1, '7d': 1, month: 4.3, '30d': 4.3, year: 52, '365d': 52 }[rangeKey];
  const throughput      = +(totalCompleted / periodWeeks).toFixed(1);
  const priorThroughput = +(priorCompleted / periodWeeks).toFixed(1);

  const completionRate      = totalCreated   > 0 ? Math.round((totalCompleted / totalCreated)   * 100) : 0;
  const priorCompletionRate = priorCreated   > 0 ? Math.round((priorCompleted / priorCreated)   * 100) : 0;

  const cycle = dataStats.avgInProgressDays ?? 0;

  return {
    opt,
    labels,
    series,
    totals: { created: totalCreated, completed: totalCompleted },
    kpis: {
      created:    { value: totalCreated,   delta: pct(totalCreated,   priorCreated)   },
      completed:  { value: totalCompleted, delta: pct(totalCompleted, priorCompleted) },
      throughput: { value: throughput,     delta: pct(throughput, priorThroughput), unit: '/wk' },
      cycle:      { value: cycle,          delta: 0, unit: 'd', deltaInverse: true },
      rate:       { value: completionRate, delta: completionRate - priorCompletionRate, unit: '%' },
    },
  };
}

function StatsOverview({ dataStats, mostActiveProject, history }) {
  const [range, setRange] = useState("week");
  const [chartMode, setChartMode] = useState("cumulative"); // cumulative | breakdown
  const [hiddenStatuses, setHiddenStatuses] = useState(new Set());
  const stats = useMemo(() => computeRangeStats(range, dataStats, history), [range, dataStats, history]);

  const visibleStatuses = CHART_STATUSES.filter(s => !hiddenStatuses.has(s.key));

  // Both modes show stacked totals; max is bucket sum across visible series.
  const maxBar = useMemo(() => {
    let m = 1;
    for (let i = 0; i < stats.labels.length; i++) {
      const s = visibleStatuses.reduce((acc, st) => acc + stats.series[st.key][i], 0);
      if (s > m) m = s;
    }
    return m;
  }, [stats, visibleStatuses]);

  const dense = stats.labels.length > 12;
  const labelStride = dense ? Math.ceil(stats.labels.length / 8) : 1;

  const toggleStatus = (key) => {
    setHiddenStatuses(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <section className="card span-2 stats-card">
      <div className="card-head stats-head">
        <div>
          <h3>Stats overview</h3>
          <span className="card-sub">{stats.opt.label.toLowerCase()} · most active in <strong>{mostActiveProject}</strong></span>
        </div>
        <div className="range-switch" role="tablist" aria-label="Stats range">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              role="tab"
              aria-selected={range === opt.key}
              className={`range-btn ${range === opt.key ? "active" : ""}`}
              onClick={() => setRange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi label="Created"   {...stats.kpis.created}/>
        <Kpi label="Completed" {...stats.kpis.completed}/>
        <Kpi label="Throughput" {...stats.kpis.throughput}/>
        <Kpi label="Avg cycle" {...stats.kpis.cycle}/>
        <Kpi label="Completion rate" {...stats.kpis.rate}/>
      </div>

      <div className="chart-head">
        <div className="chart-legend" role="group" aria-label="Toggle status series">
          {chartMode === "breakdown" ? (
            CHART_STATUSES.map(s => {
              const off = hiddenStatuses.has(s.key);
              return (
                <button
                  key={s.key}
                  className={`legend-chip ${off ? "off" : ""}`}
                  onClick={() => toggleStatus(s.key)}
                  title={off ? `Show ${s.label}` : `Hide ${s.label}`}
                >
                  <span className="lg-swatch" style={{ background: s.color }}/>
                  {s.label}
                </button>
              );
            })
          ) : (
            <span className="legend-chip static">
              <span className="lg-swatch" style={{ background: "var(--accent)" }}/>
              Total activity
            </span>
          )}
        </div>

        <div className="mode-switch" role="tablist" aria-label="Chart mode">
          <button
            className={`mode-btn ${chartMode === "cumulative" ? "active" : ""}`}
            onClick={() => setChartMode("cumulative")}
            aria-selected={chartMode === "cumulative"}
            role="tab"
            title="Cumulative — single bar per bucket"
          >
            <ModeIconCumulative/> Cumulative
          </button>
          <button
            className={`mode-btn ${chartMode === "breakdown" ? "active" : ""}`}
            onClick={() => setChartMode("breakdown")}
            aria-selected={chartMode === "breakdown"}
            role="tab"
            title="Breakdown — stacked segments per status"
          >
            <ModeIconBreakdown/> Breakdown
          </button>
        </div>
      </div>

      <div className={`stack-bars buckets-${stats.labels.length} mode-${chartMode}`}>
        {stats.labels.map((lbl, i) => {
          const showLabel = i % labelStride === 0;
          const bucketTotal = visibleStatuses.reduce((acc, st) => acc + stats.series[st.key][i], 0);
          const tip = chartMode === "breakdown"
            ? visibleStatuses.map(st => `${st.label} ${stats.series[st.key][i]}`).join(" · ")
            : `total ${bucketTotal}`;

          // Pre-compute % heights and bottoms for breakdown so segments stack
          // without flex rounding errors. Bottom = sum of segments below.
          let acc = 0;
          const segs = chartMode === "breakdown"
            ? visibleStatuses.map(st => {
                const v = stats.series[st.key][i];
                if (v === 0) return null;
                const heightPct = (v / maxBar) * 100;
                const bottomPct = (acc / maxBar) * 100;
                acc += v;
                return { st, v, heightPct, bottomPct };
              }).filter(Boolean)
            : [];

          return (
            <div key={i} className="stack-col" title={`${lbl} — ${tip}`}>
              {chartMode === "breakdown" ? (
                <div className="stack-stack">
                  {segs.map((s, idx) => (
                    <div
                      key={s.st.key}
                      className={`stack-seg ${idx === segs.length - 1 ? "top" : ""}`}
                      style={{
                        background: s.st.color,
                        height: `${s.heightPct}%`,
                        bottom: `${s.bottomPct}%`,
                      }}
                      aria-label={`${s.st.label} ${s.v}`}
                    />
                  ))}
                </div>
              ) : (
                <div className="stack-stack cumulative-stack">
                  <div
                    className="stack-seg cumulative top"
                    style={{ height: `${(bucketTotal / maxBar) * 100}%`, bottom: 0 }}
                    aria-label={`total ${bucketTotal}`}
                  />
                </div>
              )}
              <div className="stack-cap">
                {showLabel ? lbl : ""}
                {showLabel && bucketTotal > 0 && (
                  <span className="stack-total">{bucketTotal}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const ModeIconCumulative = () => (
  <svg width="14" height="12" viewBox="0 0 14 12" fill="none" aria-hidden>
    <rect x="0.5" y="6" width="3" height="5" fill="currentColor"/>
    <rect x="5.5" y="3" width="3" height="8" fill="currentColor"/>
    <rect x="10.5" y="5" width="3" height="6" fill="currentColor"/>
  </svg>
);
const ModeIconBreakdown = () => (
  <svg width="14" height="12" viewBox="0 0 14 12" fill="none" aria-hidden>
    <rect x="1" y="6" width="3" height="5" fill="currentColor" opacity="0.4"/>
    <rect x="1" y="2" width="3" height="4" fill="currentColor"/>
    <rect x="5.5" y="4" width="3" height="7" fill="currentColor" opacity="0.4"/>
    <rect x="5.5" y="1" width="3" height="3" fill="currentColor"/>
    <rect x="10" y="7" width="3" height="4" fill="currentColor" opacity="0.4"/>
    <rect x="10" y="3" width="3" height="4" fill="currentColor"/>
  </svg>
);

function Kpi({ label, value, delta, unit, accent, deltaInverse }) {
  // For metrics where lower is better (cycle time), invert sign
  const positive = deltaInverse ? delta < 0 : delta > 0;
  const negative = deltaInverse ? delta > 0 : delta < 0;
  const arrow = delta === 0 ? "→" : positive ? "▲" : "▼";
  const cls = delta === 0 ? "flat" : positive ? "up" : "down";
  const formatted = Math.abs(delta) === 0 ? "0" : `${Math.abs(delta)}${unit === "%" ? "pp" : "%"}`;
  return (
    <div className={`kpi ${accent ? "kpi-accent" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value}{unit && <span className="kpi-unit">{unit}</span>}
      </div>
      <div className={`kpi-delta ${cls}`}>
        <span className="kpi-arrow">{arrow}</span> {formatted} <span className="kpi-vs">vs prior</span>
      </div>
    </div>
  );
}

const ICON_STYLES = [
  { value: 'color', label: 'Color',  hint: 'Filled circles with semantic colors' },
  { value: 'flat',  label: 'Flat',   hint: 'Minimal monochrome SVG squares' },
  { value: 'emoji', label: 'Emoji',  hint: 'Native emoji glyphs' },
  { value: 'ascii', label: 'ASCII',  hint: 'Plain text glyphs: [ ] [/] [!] …' },
];

const THEMES = [
  { value: 'system', label: 'System', hint: 'Follow OS light / dark setting' },
  { value: 'light',  label: 'Light',  hint: 'Always light' },
  { value: 'dark',   label: 'Dark',   hint: 'Always dark' },
];

function AppearanceCard({ tweaks, setTweak }) {
  const current = tweaks?.status_style || 'color';
  const theme   = tweaks?.theme || 'system';
  return (
    <section className="card">
      <div className="card-head"><h3>Appearance</h3></div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '4px 0 6px' }}>Theme</div>
      <div className="seg" style={{ marginBottom: 14 }}>
        {THEMES.map(t => (
          <button key={t.value}
            className={`seg-btn ${theme === t.value ? 'active' : ''}`}
            title={t.hint}
            onClick={() => setTweak('theme', t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '4px 0 6px' }}>Status icons</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ICON_STYLES.map(opt => (
          <label key={opt.value}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
              background: current === opt.value ? 'var(--bg-2)' : 'transparent',
              border: `1px solid ${current === opt.value ? 'var(--rule)' : 'transparent'}`,
            }}>
            <input type="radio" name="icon-style" value={opt.value}
              checked={current === opt.value}
              onChange={() => setTweak('status_style', opt.value)}
              style={{ accentColor: 'var(--accent)', flexShrink: 0 }}/>
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
              {['open','in-progress','blocked','postponed','done','cancelled'].map(s => (
                <StatusStyleContext.Provider key={s} value={opt.value}>
                  <StatusIcon status={s} size={14}/>
                </StatusStyleContext.Provider>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{opt.label}</span>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{opt.hint}</span>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}

function AdminPage({ data, onClose, history, tweaks, setTweak, onForceSave, onForceBackup, onCompact, onRestore, onDownloadBackup }) {
  const [previewBackup, setPreviewBackup] = useState(null);

  const counts = countByStatus(data.entries);
  const total = countAll(data.entries);
  const maxStat = Math.max(1, ...Object.values(data.stats.statusMix));

  return (
    <div className="admin">
      <div className="admin-head">
        <div>
          <div className="eyebrow">Admin · Maintenance</div>
          <h2>System overview</h2>
        </div>
        <button className="btn-secondary" onClick={onClose}>← Back to backlog</button>
      </div>

      <div className="admin-grid">
        {/* Health */}
        <section className="card span-2">
          <div className="card-head">
            <h3>System health</h3>
            <span className={`pill ${data.health.integrityOk ? "ok" : "warn"}`}>
              {data.health.integrityOk ? "✓ integrity ok" : "checksum mismatch"}
            </span>
          </div>
          <dl className="kv">
            <div><dt>Last save</dt><dd>{fmtTimestamp(data.health.lastSave)}</dd></div>
            <div><dt>Last backup</dt><dd>{fmtTimestamp(data.health.lastBackup)}</dd></div>
            <div><dt>Storage mode</dt><dd>{data.health.mode}</dd></div>
            {data.health.masterPath && (
              <div><dt>File path</dt><dd className="mono small">{data.health.masterPath}</dd></div>
            )}
            <div><dt>Checksum</dt><dd className="mono small">{data.meta.checksum.slice(0, 32)}…</dd></div>
            <div><dt>Saved at</dt><dd className="mono small">{data.meta.saved}</dd></div>
            <div><dt>Entries / history</dt><dd>{data.meta.entryCount} · {data.meta.historyCount}</dd></div>
          </dl>
        </section>

        {/* Storage */}
        <section className="card">
          <div className="card-head">
            <h3>Storage</h3>
            <span className="card-sub mono">{fmtBytes(data.health.masterSize + data.health.backupDirSize + data.health.statsSize + data.health.historySize)} total</span>
          </div>
          <dl className="kv">
            <div><dt>backlog.md</dt><dd>{fmtBytes(data.health.masterSize)} · {data.meta.entryCount} entries</dd></div>
            {data.health.masterPath && (
              <div><dt>Path</dt><dd className="mono small">{data.health.masterPath}</dd></div>
            )}
            <div><dt>history.jsonl</dt><dd>{fmtBytes(data.health.historySize)} · {data.meta.historyCount.toLocaleString()} events</dd></div>
            <div><dt>backups/</dt><dd>{fmtBytes(data.health.backupDirSize)} · {data.health.backupCount} files</dd></div>
            {data.health.backupsPath && (
              <div><dt>Backups</dt><dd className="mono small">{data.health.backupsPath}</dd></div>
            )}
            <div><dt>stats.jsonl</dt><dd>{fmtBytes(data.health.statsSize)} · 90-day rollup</dd></div>
            <div><dt>Oldest event</dt><dd className="mono small">{fmtTimestamp(data.health.historyOldest)}</dd></div>
          </dl>
        </section>

        {/* Manual actions */}
        <section className="card">
          <div className="card-head"><h3>Manual actions</h3></div>
          <div className="action-list">
            <button className="action-btn" onClick={onForceSave}>
              <Icon name="save" size={14}/>
              <span className="action-text">
                <span className="action-label">Force save</span>
                <span className="action-meta">last save {fmtRelative(data.health.lastSave)}</span>
              </span>
            </button>
            <button className="action-btn" onClick={onForceBackup}>
              <Icon name="archive" size={14}/>
              <span className="action-text">
                <span className="action-label">Force backup</span>
                <span className="action-meta">{data.health.backupCount} files · {fmtBytes(data.health.backupDirSize)}</span>
              </span>
            </button>
            <button className="action-btn" onClick={onCompact}>
              <Icon name="refresh" size={14}/>
              <span className="action-text">
                <span className="action-label">Compact history</span>
                <span className="action-meta">{data.meta.historyCount.toLocaleString()} events · {fmtBytes(data.health.historySize)} · since {fmtShortDate(data.health.historyOldest)}</span>
              </span>
            </button>
          </div>
        </section>

        {/* Stats overview */}
        <StatsOverview dataStats={data.stats} mostActiveProject={data.stats.mostActiveProject} history={history}/>

        {/* Appearance */}
        <AppearanceCard tweaks={tweaks} setTweak={setTweak}/>

        {/* Status mix */}
        <section className="card">
          <div className="card-head"><h3>Status mix</h3></div>
          <div className="status-mix">
            {STATUSES.map(s => {
              const v = data.stats.statusMix[s.key] || 0;
              return (
                <div key={s.key} className="mix-row">
                  <span className={`glyph status-${s.key}`}>{s.glyph}</span>
                  <span className="mix-label">{s.label}</span>
                  <span className="mix-bar">
                    <span className="mix-fill" style={{ width: `${(v / maxStat) * 100}%` }} />
                  </span>
                  <span className="mix-num">{v}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Backup browser */}
        <section className="card span-3">
          <div className="card-head">
            <h3>Backup browser</h3>
            <span className="card-sub">{data.backups.length} files · keeping ≥7 days, ≥30 days of dailies</span>
          </div>
          <table className="backup-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Timestamp</th>
                <th>Size</th>
                <th>Entries</th>
                <th>Integrity</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.backups.map(b => (
                <tr key={b.name} className={previewBackup === b.name ? "active" : ""}>
                  <td className="mono">{b.name}</td>
                  <td>{fmtTimestamp(b.timestamp)}</td>
                  <td>{fmtBytes(b.size)}</td>
                  <td>{b.entries ?? <span className="muted">—</span>}</td>
                  <td>
                    {b.valid
                      ? <span className="pill mini ok">✓ valid</span>
                      : <span className="pill mini warn"><Icon name="warn" size={10}/> mismatch</span>}
                  </td>
                  <td className="row-actions-cell">
                    <button className="row-btn" onClick={() => setPreviewBackup(previewBackup === b.name ? null : b.name)}>
                      <Icon name="eye" size={12}/> Preview
                    </button>
                    <button className="row-btn" onClick={() => onDownloadBackup(b.name)}>
                      <Icon name="download" size={12}/> Download
                    </button>
                    <button className="row-btn primary" onClick={() => onRestore(b)}>
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {previewBackup && (
            <div className="backup-preview">
              <div className="preview-head">
                <span className="mono">{previewBackup}</span>
                <span className="card-sub">read-only preview</span>
              </div>
              <pre className="preview-body">{`# Backlog

<!-- SECTION: ENTRIES -->

## [P0] 🔥 Personal backlog app
- [x] Markdown parser + integrity marker *(done: 2026-04-29)*
  - [x] Tokenize three sections
  - [x] SHA-256 over entries+history
- [/] Tree renderer with parent-visibility filter *(due: 2026-05-04)*
  - [ ] Expand / collapse animations
  - [ ] Drag handle within priority group *(due: 2026-05-06)*
- [!] File System Access API direct mode *(reason: Need to test on Edge — no machine yet)*
…

<!-- SECTION: HISTORY -->
| Timestamp | Item ID | Action | Details |
…

<!-- SECTION: INTEGRITY -->
<!-- saved: 2026-04-30T19:44:02Z | checksum: sha256:8a1c3e… | entries: 27 | history: 10 -->`}</pre>
            </div>
          )}
        </section>

        {/* Recent history */}
        <section className="card span-3">
          <div className="card-head">
            <h3>Audit log</h3>
            <span className="card-sub">
              <strong>{data.meta.historyCount.toLocaleString()}</strong> events ·
              {" "}{fmtBytes(data.health.historySize)} ·
              {" "}since {fmtShortDate(data.health.historyOldest)} ·
              {" "}showing latest 10
            </span>
          </div>
          <table className="history-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Item ID</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 10).map((h, i) => (
                <tr key={i}>
                  <td className="mono small">{h.timestamp}</td>
                  <td className="mono small">{h.itemId}</td>
                  <td><span className="pill mini neutral">{h.action.replace(/_/g, " ")}</span></td>
                  <td>{h.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

    </div>
  );
}

window.AdminPage = AdminPage;
