// Filter sidebar: status, priority, due, tags + scope.

function FilterPanel({ filters, setFilters, tagsList, counts }) {
  const toggle = (key, val) => {
    const cur = new Set(filters[key] || []);
    cur.has(val) ? cur.delete(val) : cur.add(val);
    setFilters({ ...filters, [key]: [...cur] });
  };
  const isActive = (key, val) => (filters[key] || []).includes(val);

  return (
    <aside className="filter-panel">
      <div className="filter-section">
        <div className="filter-label">Status</div>
        <div className="filter-list">
          {STATUSES.map(s => (
            <button
              key={s.key}
              className={`filter-chip ${isActive("statuses", s.key) ? "active" : ""}`}
              onClick={() => toggle("statuses", s.key)}
            >
              <StatusIcon status={s.key} size={13}/>
              <span className="filter-name">{s.label}</span>
              <span className="filter-count">{counts[s.key] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">Priority</div>
        <div className="filter-list filter-list-row">
          {PRIORITIES.map(p => (
            <button
              key={p}
              className={`filter-chip mini ${isActive("priorities", p) ? "active" : ""} pri-${p}`}
              onClick={() => toggle("priorities", p)}
            >
              {p === "P0" && <span className="p0-dot" />}
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-label">Due</div>
        <div className="filter-list">
          {[
            { k: "overdue", n: "Overdue" },
            { k: "today",   n: "Today" },
            { k: "week",    n: "This week" },
            { k: "month",   n: "This month" }
          ].map(o => (
            <button
              key={o.k}
              className={`filter-chip ${filters.dueRange === o.k ? "active" : ""}`}
              onClick={() => setFilters({ ...filters, dueRange: filters.dueRange === o.k ? null : o.k })}
            >
              <span className="filter-name">{o.n}</span>
            </button>
          ))}
        </div>
      </div>

      <TagFilter
        tagsList={tagsList}
        selected={filters.tags || []}
        onToggle={(t) => toggle("tags", t)}
      />

      <div className="filter-section">
        <div className="filter-label">Scope</div>
        <div className="filter-list">
          {[
            { k: "all", n: "All items" },
            { k: "top", n: "Top-level only" }
          ].map(o => (
            <button
              key={o.k}
              className={`filter-chip ${(filters.scope || "all") === o.k ? "active" : ""}`}
              onClick={() => setFilters({ ...filters, scope: o.k })}
            >
              <span className="filter-name">{o.n}</span>
            </button>
          ))}
        </div>
      </div>

      {(filters.statuses?.length || filters.priorities?.length || filters.tags?.length || filters.dueRange) && (
        <button className="clear-btn"
          onClick={() => setFilters({ statuses: [], priorities: [], tags: [], dueRange: null, scope: filters.scope, text: filters.text })}>
          Clear filters
        </button>
      )}
    </aside>
  );
}

// ---- Tag filter with autocomplete (handles hundreds of tags) ----
function TagFilter({ tagsList, selected, onToggle }) {
  const [q, setQ] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef(null);

  if (!tagsList.length) return null;

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? tagsList.filter(t => t.toLowerCase().includes(ql)).slice(0, 50)
    : tagsList.slice(0, 12); // top dozen by frequency when not searching
  const exact = ql && tagsList.includes(ql);
  const TOTAL = tagsList.length;

  return (
    <div className="filter-section">
      <div className="filter-label">
        Tags <span className="tag-total mono">{TOTAL}</span>
      </div>

      {/* Selected tags chips (always visible if any) */}
      {selected.length > 0 && (
        <div className="tag-selected">
          {selected.map(t => (
            <button key={t} className="tag-chip active" onClick={() => onToggle(t)} title="Remove">
              #{t}
              <span className="tag-x">×</span>
            </button>
          ))}
        </div>
      )}

      {/* Search field */}
      <div className={`tag-search ${focused ? "focused" : ""}`}>
        <Icon name="search" size={12}/>
        <input
          ref={inputRef}
          className="tag-search-input"
          placeholder={`Search ${TOTAL} tags…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered.length > 0) {
              onToggle(filtered[0]);
              setQ("");
            } else if (e.key === "Escape") {
              setQ("");
              e.currentTarget.blur();
            }
          }}
        />
        {q && <button className="tag-search-clear" onClick={() => { setQ(""); inputRef.current?.focus(); }}>×</button>}
      </div>

      {/* Results / suggestions */}
      <div className="tag-results">
        {filtered.length === 0 ? (
          <div className="tag-empty">No tags match "{q}"</div>
        ) : (
          <>
            {filtered.map(t => {
              const isSelected = selected.includes(t);
              return (
                <button
                  key={t}
                  className={`tag-chip ${isSelected ? "active" : ""}`}
                  onClick={() => onToggle(t)}
                  title={isSelected ? "Remove from filter" : "Add to filter"}
                >
                  {ql && !isSelected ? <TagHighlight text={t} match={ql}/> : `#${t}`}
                </button>
              );
            })}
            {!ql && tagsList.length > 12 && (
              <span className="tag-more mono">+{tagsList.length - 12} more — type to find</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TagHighlight({ text, match }) {
  const i = text.toLowerCase().indexOf(match);
  if (i < 0) return `#${text}`;
  return (
    <>
      #{text.slice(0, i)}<span className="hl">{text.slice(i, i + match.length)}</span>{text.slice(i + match.length)}
    </>
  );
}

window.FilterPanel = FilterPanel;
