// Backlog tree view: rows, expand/collapse, status cycling, drag handle, add/delete.

const { useState, useRef, useEffect, useMemo } = React;

// Inline priority popover
function PriorityPicker({ value, onChange, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  return (
    <div className="pri-pop" ref={ref} onClick={(e) => e.stopPropagation()}>
      {PRIORITIES.map(p => (
        <button key={p} className={`pri-pop-item pri-${p} ${value === p ? "active" : ""}`}
          onClick={() => { onChange(p); onClose(); }}>
          {p === "P0" && <span className="p0-dot"/>}
          <span>{p}</span>
          <span className="pri-pop-hint">{p === "P0" ? "Burning" : p === "P1" ? "High" : p === "P2" ? "Normal" : "Low"}</span>
        </button>
      ))}
    </div>
  );
}

// Inline status popover (replaces ●●● menu)
function StatusPopover({ value, style, onChange, onClose, anchorRect }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  return (
    <div className="status-pop" ref={ref} onClick={(e) => e.stopPropagation()}>
      {STATUSES.map(s => (
        <button key={s.key} className={`status-pop-item ${value === s.key ? "active" : ""}`}
          onClick={() => { onChange(s.key); onClose(); }}>
          <StatusIcon status={s.key} style={style} size={14}/>
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

// Single tree row
function ItemRow({ item, depth, expanded, hasChildren, statusStyle,
  onToggle, onSetStatus, onAddChild, onDelete, onEdit, onSetPriority,
  onMoveUp, onMoveDown, canMoveUp, canMoveDown,
  onDragStart, onDragOver, onDrop,
  dimmed, query, dropTarget }) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [priOpen, setPriOpen] = useState(false);

  const overdue = isOverdue(item);
  const isP0 = item.priority === "P0" && item.status !== "done" && item.status !== "cancelled";
  const isDone = item.status === "done" || item.status === "cancelled";

  const renderTitle = () => {
    if (!query) return item.title;
    const i = item.title.toLowerCase().indexOf(query.toLowerCase());
    if (i < 0) return item.title;
    return (<>
      {item.title.slice(0, i)}
      <mark className="hl">{item.title.slice(i, i + query.length)}</mark>
      {item.title.slice(i + query.length)}
    </>);
  };

  return (
    <div
      className={`row level-${depth} ${dimmed ? "dimmed" : ""} ${isP0 ? "p0" : ""} ${dropTarget ? "drop-target" : ""}`}
      draggable
      onDragStart={(e) => onDragStart?.(e, item)}
      onDragOver={(e) => onDragOver?.(e, item)}
      onDrop={(e) => onDrop?.(e, item)}
    >
      <span className="row-rail" style={{ width: depth * 18 }}/>

      <button
        className={`twisty ${hasChildren ? "" : "empty"}`}
        onClick={hasChildren ? onToggle : undefined}
        aria-label={expanded ? "Collapse" : "Expand"}
        tabIndex={hasChildren ? 0 : -1}
      >
        {hasChildren && <Icon name={expanded ? "chevron" : "chevronRight"} size={12}/>}
      </button>

      <span className="drag-handle" title="Drag to reorder within priority"><Icon name="drag" size={14}/></span>

      <span className="status-wrap">
        <button
          className="status-btn"
          onClick={() => setStatusOpen(v => !v)}
          title={`${STATUS_BY_KEY[item.status].label} — click to change`}
        >
          <StatusIcon status={item.status} style={statusStyle} size={14}/>
        </button>
        {statusOpen && (
          <StatusPopover value={item.status} style={statusStyle}
            onChange={onSetStatus} onClose={() => setStatusOpen(false)}/>
        )}
      </span>

      <span className="pri-wrap">
        <button className={`pri pri-${item.priority}`} onClick={() => setPriOpen(v => !v)} title="Change priority">
          {item.priority === "P0" && <span className="p0-dot"/>}
          {item.priority}
        </button>
        {priOpen && (
          <PriorityPicker value={item.priority}
            onChange={(p) => onSetPriority(p)}
            onClose={() => setPriOpen(false)}/>
        )}
      </span>

      <span className={`title ${isDone ? "done" : ""}`} onDoubleClick={onEdit}>
        {renderTitle()}
      </span>

      {shouldShowProgress(item) && (
        <ProgressGauge value={progressFor(item)} />
      )}

      {item.due && (
        <span className={`due ${overdue ? "overdue" : ""}`}>{dueRelative(item)}</span>
      )}

      {item.tags?.length > 0 && (
        <span className="tags">
          {item.tags.map(t => <span key={t} className="tag">#{t}</span>)}
        </span>
      )}

      {item.status === "blocked" && item.reason && (
        <span className="reason" title={item.reason}>↳ {item.reason}</span>
      )}

      <span className="row-spacer"/>

      <span className="row-actions">
        <button className="icon-btn" onClick={onMoveUp} disabled={!canMoveUp} data-tip="Move up" aria-label="Move up">
          <svg width="14" height="14" viewBox="0 0 16 16"><polyline points="4,10 8,5 12,10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button className="icon-btn" onClick={onMoveDown} disabled={!canMoveDown} data-tip="Move down" aria-label="Move down">
          <svg width="14" height="14" viewBox="0 0 16 16"><polyline points="4,6 8,11 12,6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="action-sep"/>
        {depth < 3 && (
          <button className="icon-btn" onClick={onAddChild} data-tip="Add sub-item" aria-label="Add sub-item">
            <Icon name="addChild" size={14}/>
          </button>
        )}
        <button className="icon-btn" onClick={onEdit} data-tip="Edit item" aria-label="Edit item">
          <Icon name="edit" size={13}/>
        </button>
        <button className="icon-btn danger" onClick={onDelete} data-tip="Delete" aria-label="Delete">
          <Icon name="trash" size={13}/>
        </button>
      </span>
    </div>
  );
}

// Expanded-state map kept in parent so filtering doesn't lose it.
function BacklogTree({ items, expandedMap, setExpanded, onMutate, query, statusStyle, manualOrder }) {
  const [draggedId, setDraggedId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  const onDragStart = (e, item) => {
    setDraggedId(item.id);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", item.id); } catch (_) {}
  };
  const onDragOver = (e, item) => {
    if (!draggedId || draggedId === item.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(item.id);
  };
  const onDrop = (e, item) => {
    e.preventDefault();
    if (draggedId && draggedId !== item.id) {
      onMutate.reorder(draggedId, item.id);
    }
    setDraggedId(null); setDropTargetId(null);
  };

  function renderList(list, depth, parentList) {
    return list.map((item, idx) => {
      const expanded = expandedMap[item.id] ?? !item.collapsed;
      const hasChildren = item.children?.length > 0;
      const forceOpen = query && item._matches !== true && hasChildren;
      const showKids = (expanded || forceOpen) && hasChildren;

      // can-move logic: only swap with adjacent same-priority sibling
      const samePri = parentList
        .map((x, i) => ({ x, i }))
        .filter(({ x }) => x.priority === item.priority);
      const myIdx = samePri.findIndex(({ x }) => x.id === item.id);
      const canMoveUp = myIdx > 0;
      const canMoveDown = myIdx >= 0 && myIdx < samePri.length - 1;

      return (
        <React.Fragment key={item.id}>
          <ItemRow
            item={item} depth={depth}
            expanded={expanded || forceOpen}
            hasChildren={hasChildren}
            statusStyle={statusStyle}
            dimmed={query && item._matches === false}
            dropTarget={dropTargetId === item.id && draggedId !== item.id}
            query={query}
            onToggle={() => setExpanded(item.id, !expanded)}
            onSetStatus={(s) => onMutate.setStatus(item.id, s)}
            onSetPriority={(p) => onMutate.setPriority(item.id, p)}
            onAddChild={() => onMutate.addChild(item.id)}
            onDelete={() => onMutate.deleteItem(item.id)}
            onEdit={() => onMutate.editItem(item.id)}
            onMoveUp={() => onMutate.moveWithinPriority(item.id, -1)}
            onMoveDown={() => onMutate.moveWithinPriority(item.id, +1)}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          />
          {showKids && renderList(item.children, depth + 1, item.children)}
        </React.Fragment>
      );
    });
  }
  return <div className="tree">{renderList(items, 0, items)}</div>;
}

window.BacklogTree = BacklogTree;
