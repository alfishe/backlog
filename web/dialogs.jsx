// Stylish dialog primitives + concrete dialogs (Edit/Add Item, Confirm).

const { useState: useStateD, useEffect: useEffectD, useRef: useRefD } = React;

function Dialog({ open, onClose, children, width = 460, labelledBy }) {
  useEffectD(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={{ maxWidth: width }}>
        {children}
      </div>
    </div>
  );
}

function DialogHeader({ eyebrow, title, onClose, id }) {
  return (
    <div className="dlg-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h3 id={id} className="dlg-title">{title}</h3>
      </div>
      {onClose && (
        <button className="dlg-close" onClick={onClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
        </button>
      )}
    </div>
  );
}

// --- Item editor (used for both edit and add) ---
function ItemDialog({ open, mode, initial, onClose, onSubmit, recentTags = [] }) {
  const [title, setTitle] = useStateD("");
  const [priority, setPriority] = useStateD("P2");
  const [status, setStatus] = useStateD("open");
  const [due, setDue] = useStateD("");
  const [tags, setTags] = useStateD([]);
  const [tagInput, setTagInput] = useStateD("");
  const [reason, setReason] = useStateD("");
  const [progress, setProgress] = useStateD(0);
  const titleRef = useRefD(null);

  useEffectD(() => {
    if (!open) return;
    setTitle(initial?.title || "");
    setPriority(initial?.priority || "P2");
    setStatus(initial?.status || "open");
    setDue(initial?.due || "");
    setTags(initial?.tags || []);
    setTagInput("");
    setReason(initial?.reason || "");
    setProgress(initial?.progress ?? 0);
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [open, initial]);

  const addTag = (t) => {
    const v = t.trim().replace(/^#/, "");
    if (!v) return;
    if (tags.includes(v)) return;
    setTags([...tags, v]);
  };
  const removeTag = (t) => setTags(tags.filter(x => x !== t));

  const submit = (e) => {
    e?.preventDefault();
    if (!title.trim()) return;
    // Reconcile progress with status before submitting.
    let outProgress = snapProgress(progress);
    if (status === "done") outProgress = 100;
    onSubmit({
      title: title.trim(),
      priority, status,
      due: due || null,
      tags,
      reason: status === "blocked" ? reason.trim() || null : null,
      progress: outProgress
    });
  };

  const tagSuggestions = recentTags.filter(t => !tags.includes(t)).slice(0, 8);

  return (
    <Dialog open={open} onClose={onClose} width={520} labelledBy="dlg-item-title">
      <form onSubmit={submit}>
        <DialogHeader
          id="dlg-item-title"
          eyebrow={mode === "edit" ? "Edit item" : (mode === "add-child" ? "Add sub-item" : "New item")}
          title={mode === "edit" ? "Edit details" : "Create item"}
          onClose={onClose}
        />

        <div className="dlg-body">
          <div className="field">
            <label className="field-label">Title</label>
            <input
              ref={titleRef}
              className="text-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to happen?"
              required
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label">Priority</label>
              <div className="seg">
                {PRIORITIES.map(p => (
                  <button type="button" key={p}
                    className={`seg-btn pri-${p} ${priority === p ? "active" : ""}`}
                    onClick={() => setPriority(p)}>
                    {p === "P0" && <span className="p0-dot"/>}
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field-label">Due</label>
              <input className="text-input" type="date" value={due} onChange={(e) => setDue(e.target.value)}/>
            </div>
          </div>

          <div className="field">
            <label className="field-label">Status</label>
            <div className="status-grid">
              {STATUSES.map(s => (
                <button type="button" key={s.key}
                  className={`status-card ${status === s.key ? "active" : ""}`}
                  onClick={() => setStatus(s.key)}>
                  <span className={`status-card-icon status-${s.key}`}>
                    <StatusIcon status={s.key} size={16}/>
                  </span>
                  <span className="status-card-label">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {status !== "cancelled" && (
            <div className="field">
              <label className="field-label">
                Completion
                <span className="field-hint">
                  {status === "done"
                    ? "locked at 100% while marked done"
                    : "rough estimate — set 100% to mark done"}
                </span>
              </label>
              <div className="progress-row">
                <div className={`seg progress-seg ${status === "done" ? "locked" : ""}`}>
                  {PROGRESS_STEPS.map(p => (
                    <button type="button" key={p}
                      className={`seg-btn ${progress === p ? "active" : ""}`}
                      onClick={() => setProgress(p)}
                      disabled={status === "done"}>
                      {p}%
                    </button>
                  ))}
                </div>
                <ProgressGauge value={status === "done" ? 100 : progress} size="md"/>
              </div>
            </div>
          )}

          {status === "blocked" && (
            <div className="field">
              <label className="field-label">Block reason</label>
              <input className="text-input" value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Waiting for…"/>
            </div>
          )}

          <div className="field">
            <label className="field-label">Tags <span className="field-hint">type a name, press Enter or comma to add</span></label>
            <TagAutocompleteInput
              tags={tags}
              setTags={setTags}
              tagInput={tagInput}
              setTagInput={setTagInput}
              addTag={addTag}
              removeTag={removeTag}
              allTags={recentTags}
            />
          </div>
        </div>

        <div className="dlg-foot">
          <span className="dlg-hint">⌘↩ to save · Esc to cancel</span>
          <div className="dlg-foot-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!title.trim()}>
              {mode === "edit" ? "Save changes" : "Create item"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

// --- Confirm dialog ---
function ConfirmDialog({ open, title, message, detail, confirmLabel = "Confirm", danger = false, onCancel, onConfirm }) {
  return (
    <Dialog open={open} onClose={onCancel} width={420} labelledBy="dlg-confirm-title">
      <DialogHeader id="dlg-confirm-title" eyebrow="Confirm" title={title} onClose={onCancel}/>
      <div className="dlg-body">
        <p className="dlg-msg">{message}</p>
        {detail && <div className="dlg-detail">{detail}</div>}
      </div>
      <div className="dlg-foot">
        <span/>
        <div className="dlg-foot-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button"
            className={danger ? "btn-danger" : "btn-primary"}
            onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Tag autocomplete (typed input + filtered dropdown) ---
function TagAutocompleteInput({ tags, setTags, tagInput, setTagInput, addTag, removeTag, allTags }) {
  const [focused, setFocused] = useStateD(false);
  const [highlighted, setHighlighted] = useStateD(0);
  const inputRef = useRefD(null);
  const wrapRef = useRefD(null);

  const q = tagInput.trim().toLowerCase().replace(/^#/, "");
  // suggestions: filter out already-applied; rank exact prefix > contains
  const pool = (allTags || []).filter(t => !tags.includes(t));
  let suggestions;
  if (q) {
    const starts = pool.filter(t => t.toLowerCase().startsWith(q));
    const contains = pool.filter(t => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q));
    suggestions = [...starts, ...contains].slice(0, 8);
  } else {
    suggestions = pool.slice(0, 8); // recents
  }
  const exactMatch = q && pool.some(t => t.toLowerCase() === q);
  const showCreate = q && !exactMatch && !tags.includes(q);
  // index 0 = "create new" (if shown), then suggestions
  const items = [
    ...(showCreate ? [{ kind: "create", value: q }] : []),
    ...suggestions.map(t => ({ kind: "suggestion", value: t }))
  ];

  useEffectD(() => { setHighlighted(0); }, [tagInput, focused]);

  const pick = (it) => {
    if (!it) return;
    addTag(it.value);
    setTagInput("");
    setHighlighted(0);
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) setHighlighted((h) => (h + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setHighlighted((h) => (h - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[highlighted]) pick(items[highlighted]);
      else if (tagInput.trim()) { addTag(tagInput); setTagInput(""); }
    } else if (e.key === "," || e.key === "Tab") {
      if (tagInput.trim()) {
        e.preventDefault();
        if (items[highlighted]) pick(items[highlighted]);
        else { addTag(tagInput); setTagInput(""); }
      }
    } else if (e.key === "Backspace" && !tagInput && tags.length) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === "Escape") {
      if (tagInput) { setTagInput(""); e.preventDefault(); }
      else inputRef.current?.blur();
    }
  };

  return (
    <div className="tag-ac" ref={wrapRef}>
      <div className={`tag-input ${focused ? "focused" : ""}`} onClick={(e) => {
        if (e.target === e.currentTarget) inputRef.current?.focus();
      }}>
        {tags.map(t => (
          <span key={t} className="tag-pill">
            #{t}
            <button type="button" onClick={() => removeTag(t)} aria-label={`Remove ${t}`}>×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="tag-input-field"
          placeholder={tags.length ? "+ add tag" : "e.g. urgent, frontend, errand"}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={onKey}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={focused && items.length > 0}
        />
      </div>

      {focused && items.length > 0 && (
        <div className="tag-ac-pop" role="listbox">
          {!q && (
            <div className="tag-ac-cap">Recent</div>
          )}
          {items.map((it, i) => (
            <button
              key={`${it.kind}-${it.value}`}
              type="button"
              role="option"
              aria-selected={i === highlighted}
              className={`tag-ac-item ${i === highlighted ? "highlighted" : ""} ${it.kind === "create" ? "create" : ""}`}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(it); }}
            >
              {it.kind === "create" ? (
                <>
                  <Icon name="plus" size={11}/>
                  <span>Create <strong>#{it.value}</strong></span>
                </>
              ) : (
                <span>{q ? <TagMatchHL text={it.value} match={q}/> : `#${it.value}`}</span>
              )}
            </button>
          ))}
          <div className="tag-ac-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
            <span><kbd>↵</kbd> to add</span>
            <span><kbd>esc</kbd> to dismiss</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TagMatchHL({ text, match }) {
  const i = text.toLowerCase().indexOf(match);
  if (i < 0) return `#${text}`;
  return (
    <>
      #{text.slice(0, i)}<span className="hl">{text.slice(i, i + match.length)}</span>{text.slice(i + match.length)}
    </>
  );
}

window.Dialog = Dialog;
window.ItemDialog = ItemDialog;
window.ConfirmDialog = ConfirmDialog;
