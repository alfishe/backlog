// Main App — top shell, state management, real storage load/save flow.

const { useState: useStateMain, useEffect: useEffectMain, useMemo: useMemoMain, useRef: useRefMain } = React;

const LS_KEY = "personal-backlog-state-v1";

function loadLocalState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// Only UI state (expanded rows, tweaks) is persisted locally.
// Backlog data always lives in backlog.md — never in localStorage.
function saveLocalState(expandedMap, tweaks) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ expandedMap, tweaks })); } catch { /* quota / private mode */ }
}

// Empty starting state — used when there is no saved data and no seed data loaded.
function buildEmptyData() {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => ({ day, count: 0 }));
  return {
    entries: [],
    history: [],
    meta: { saved: null, checksum: '—', entryCount: 0, historyCount: 0 },
    health: {
      integrityOk: true, lastSave: null, lastBackup: null,
      masterSize: 0, backupDirSize: 0, backupCount: 0,
      statsSize: 0, historySize: 0, historyOldest: null,
      mode: 'localStorage only',
    },
    stats: {
      createdThisWeek: 0, completedThisWeek: 0, avgInProgressDays: null,
      mostActiveProject: '—',
      completionByDay: days.map(d => ({ ...d })),
      createdByDay:    days.map(d => ({ ...d })),
      statusMix: { open: 0, 'in-progress': 0, blocked: 0, postponed: 0, done: 0, cancelled: 0 },
    },
    backups: [],
  };
}

function App() {
  const [data, setData]             = useStateMain(buildEmptyData);
  const [storageMode, setStorageMode] = useStateMain('local'); // 'api' | 'direct' | 'local'
  const [isLoading, setIsLoading]   = useStateMain(true);
  const [view, setView]             = useStateMain('backlog');
  const [filters, setFilters]       = useStateMain({ statuses: [], priorities: [], tags: [], dueRange: null, scope: 'all', text: '' });
  const [expandedMap, setExpandedMap] = useStateMain(() => loadLocalState()?.expandedMap ?? {});
  const [saveState, setSaveState]   = useStateMain({ status: 'idle', lastSaved: data.health?.lastSave || null });
  const [toast, setToast]           = useStateMain(null);
  const [showWarning, setShowWarning] = useStateMain(false);
  const [importExportOpen, setImportExportOpen] = useStateMain(false);
  const [itemDialog, setItemDialog] = useStateMain(null);
  const [confirm, setConfirm]       = useStateMain(null);
  const [needsConnect, setNeedsConnect] = useStateMain(false);

  const TWEAK_DEFAULTS = { accent_hue: 35, density: 'comfortable', show_ids: false, paper_texture: true, status_style: 'color', sort_mode: 'priority' };
  const [tweaks, setTweak] = useTweaks({ ...TWEAK_DEFAULTS, ...(loadLocalState()?.tweaks ?? {}) });

  // Refs for async callbacks that need latest state without stale closures.
  const latestData        = useRefMain(data);
  const latestExpandedMap = useRefMain(expandedMap);
  const isDirtyRef        = useRefMain(false);
  const saveTimerRef      = useRefMain(null);

  useEffectMain(() => { latestData.current = data; },         [data]);
  useEffectMain(() => { latestExpandedMap.current = expandedMap; }, [expandedMap]);

  useEffectMain(() => {
    document.documentElement.style.setProperty('--accent-hue', tweaks.accent_hue);
    document.documentElement.dataset.density  = tweaks.density;
    document.documentElement.dataset.showIds  = tweaks.show_ids ? 'true' : 'false';
    document.documentElement.dataset.paper    = tweaks.paper_texture ? 'true' : 'false';
  }, [tweaks]);

  // ---- Storage initialisation (runs once on mount) ----
  useEffectMain(() => {
    let cancelled = false;

    async function initStorage() {
      try {
        const mode = await Storage.detect();
        setStorageMode(mode);

        if (mode === 'local') { setIsLoading(false); return; }

        if (mode === 'direct') {
          // Try silent reconnect — works if permission is still active from a previous session.
          const ok = await Storage.tryAutoConnect();
          if (!ok) {
            // Can't connect without a user gesture — show the connect button instead of blocking.
            setIsLoading(false);
            setNeedsConnect(true);
            return;
          }
        }
        // API mode needs no init — server is already running.

        if (cancelled) return;
        await applyStorageData(mode, () => cancelled);
      } catch (e) {
        if (cancelled) return;
        setStorageMode('local');
        showToast('Storage init failed: ' + e.message, 'err');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    async function applyStorageData(mode, isCancelled) {
      const [raw, backups, sizeInfo] = await Promise.all([
        Storage.load(),
        Storage.listBackups(),
        Storage.getHealthInfo(),
      ]);
      if (isCancelled?.()) return;

      const parsed  = await Parser.parse(raw?.content || '');
      const newData = await buildDataFromStorage(parsed, backups, mode || Storage.mode, sizeInfo);

      if (isCancelled?.()) return;
      setData(newData);

      if (!loadLocalState()?.expandedMap) {
        const em = {};
        walkTree(newData.entries, it => { em[it.id] = !it.collapsed; });
        setExpandedMap(em);
      }

      if (!parsed.checksumOk && parsed.meta) setShowWarning(true);

      SyncPoller.lastChecksum = parsed.meta?.checksum || '';
      SyncPoller.start({
        isDirty: () => isDirtyRef.current,
        onExternalChange: async (kind, freshParsed) => {
          if (kind === 'warn') {
            showToast('File changed externally — you have unsaved edits', 'warn');
          } else if (kind === 'reload' && freshParsed) {
            const [nb, ns] = await Promise.all([Storage.listBackups(), Storage.getHealthInfo()]);
            setData(await buildDataFromStorage(freshParsed, nb, Storage.mode, ns));
            showToast('Reloaded from disk');
          }
        },
      });
    }


    initStorage();
    return () => { cancelled = true; SyncPoller.stop(); };
  }, []);

  // Persist expanded/collapsed row state and tweaks locally. Data itself lives in backlog.md.
  useEffectMain(() => {
    saveLocalState(latestExpandedMap.current, tweaks);
  }, [expandedMap, tweaks]);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind, t: Date.now() });
    setTimeout(() => setToast(t => (t && Date.now() - t.t >= 2400) ? null : t), 2500);
  };

  // ---- Connect to backlog.md (user-triggered, called from the connect banner) ----
  const handleConnect = async () => {
    try {
      await Storage.connect();
      const [raw, backups, sizeInfo] = await Promise.all([
        Storage.load(),
        Storage.listBackups(),
        Storage.getHealthInfo(),
      ]);
      const parsed  = await Parser.parse(raw?.content || '');
      const newData = await buildDataFromStorage(parsed, backups, Storage.mode, sizeInfo);
      setData(newData);
      if (!loadLocalState()?.expandedMap) {
        const em = {};
        walkTree(newData.entries, it => { em[it.id] = !it.collapsed; });
        setExpandedMap(em);
      }
      if (!parsed.checksumOk && parsed.meta) setShowWarning(true);
      SyncPoller.lastChecksum = parsed.meta?.checksum || '';
      SyncPoller.start({
        isDirty: () => isDirtyRef.current,
        onExternalChange: async (kind, freshParsed) => {
          if (kind === 'warn') {
            showToast('File changed externally — you have unsaved edits', 'warn');
          } else if (kind === 'reload' && freshParsed) {
            const [nb, ns] = await Promise.all([Storage.listBackups(), Storage.getHealthInfo()]);
            setData(await buildDataFromStorage(freshParsed, nb, Storage.mode, ns));
            showToast('Reloaded from disk');
          }
        },
      });
      setNeedsConnect(false);
    } catch (e) {
      showToast('Connect failed: ' + e.message, 'err');
    }
  };

  // ---- Real async save ----
  const triggerSave = (label) => {
    isDirtyRef.current = true;
    setSaveState(prev => ({ ...prev, status: 'saving' }));
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      const d  = latestData.current;
      const em = latestExpandedMap.current;
      try {
        if (Storage.isConnected()) {
          const content = await Parser.serialize({ entries: d.entries, history: d.history });
          await Storage.save(content);
          // Keep SyncPoller in sync with our own save to avoid false external-change triggers.
          const cm = content.match(/checksum:\s*(sha256:[a-f0-9]+)/);
          if (cm) SyncPoller.lastChecksum = cm[1];
        }
        saveLocalState(em, tweaks);
        isDirtyRef.current = false;
        const now = new Date().toISOString();
        setSaveState({ status: 'saved', lastSaved: now });
        setData(prev => ({
          ...prev,
          health: { ...prev.health, lastSave: now },
          meta:   { ...prev.meta,   saved: now },
        }));
        if (label) showToast(label);
      } catch (e) {
        setSaveState(prev => ({ ...prev, status: 'error' }));
        showToast('Save failed: ' + e.message, 'err');
      }
    }, 600);
  };

  const mutate = (fn) => {
    isDirtyRef.current = true;
    setData(d => { const c = structuredClone(d); fn(c); return c; });
  };

  // ---- Helpers ----
  function findParentList(items, id, parent = null) {
    for (const it of items) {
      if (it.id === id) return { list: items, parent };
      if (it.children?.length) {
        const r = findParentList(it.children, id, it);
        if (r) return r;
      }
    }
    return null;
  }

  const recentTags = useMemoMain(() => {
    const counts = {};
    walkTree(data.entries, it => (it.tags || []).forEach(t => counts[t] = (counts[t] || 0) + 1));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [data]);

  // ---- Mutations ----
  const onMutate = {
    setStatus: (id, status) => {
      mutate(d => {
        const it = findItem(d.entries, id);
        if (!it || it.status === status) return;
        d.history.unshift({ timestamp: new Date().toISOString(), itemId: id, action: 'status_changed', details: `${it.status} → ${status}` });
        const wasDone = it.status === 'done';
        it.status = status;
        if (status !== 'blocked') it.reason = null;
        if (status === 'done')                    it.progress = 100;
        else if (wasDone && (it.progress ?? 0) >= 100) it.progress = 75;
      });
      triggerSave();
    },

    setPriority: (id, priority) => {
      mutate(d => {
        const it = findItem(d.entries, id);
        if (!it || it.priority === priority) return;
        d.history.unshift({ timestamp: new Date().toISOString(), itemId: id, action: 'priority_changed', details: `${it.priority} → ${priority}` });
        it.priority = priority;
      });
      triggerSave();
    },

    setProgress: (id, progress) => {
      mutate(d => {
        const it = findItem(d.entries, id);
        if (!it) return;
        const v = snapProgress(progress);
        if ((it.progress ?? 0) === v) return;
        const before = it.progress ?? 0;
        it.progress = v;
        d.history.unshift({ timestamp: new Date().toISOString(), itemId: id, action: 'progress_changed', details: `${before}% → ${v}%` });
      });
      triggerSave();
    },

    moveWithinPriority: (id, dir) => {
      mutate(d => {
        const r = findParentList(d.entries, id);
        if (!r) return;
        const i  = r.list.findIndex(x => x.id === id);
        if (i < 0) return;
        const me = r.list[i];
        let j = i + dir;
        while (j >= 0 && j < r.list.length && r.list[j].priority !== me.priority) j += dir;
        if (j < 0 || j >= r.list.length) return;
        [r.list[i], r.list[j]] = [r.list[j], r.list[i]];
        d.history.unshift({ timestamp: new Date().toISOString(), itemId: id, action: 'item_reordered', details: `moved ${dir < 0 ? 'up' : 'down'}` });
      });
      triggerSave();
    },

    reorder: (draggedId, targetId) => {
      mutate(d => {
        const src = findParentList(d.entries, draggedId);
        const tgt = findParentList(d.entries, targetId);
        if (!src || !tgt || src.list !== tgt.list) return;
        const draggedIdx = src.list.findIndex(x => x.id === draggedId);
        const dragged    = src.list[draggedIdx];
        src.list.splice(draggedIdx, 1);
        const newTargetIdx = tgt.list.findIndex(x => x.id === targetId);
        tgt.list.splice(newTargetIdx, 0, dragged);
        d.history.unshift({ timestamp: new Date().toISOString(), itemId: draggedId, action: 'item_reordered', details: `dropped before ${targetId}` });
      });
      triggerSave('Reordered');
    },

    addChild: (parentId) => setItemDialog({ mode: 'add-child', parentId, initial: null }),
    addRoot:  ()         => setItemDialog({ mode: 'add',       parentId: null, initial: null }),

    editItem: (id) => {
      const it = findItem(data.entries, id);
      if (!it) return;
      setItemDialog({ mode: 'edit', itemId: id, initial: it });
    },

    deleteItem: (id) => {
      const it = findItem(data.entries, id);
      if (!it) return;
      const childCount = (() => { let n = 0; walkTree([it], () => n++); return n - 1; })();
      setConfirm({
        title: 'Delete this item?',
        message: <>Delete <strong>{it.title}</strong>{childCount > 0 ? ` and ${childCount} sub-item${childCount > 1 ? 's' : ''}` : ''}?</>,
        detail: <span className="muted">This will be recorded in the history log.</span>,
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: () => {
          mutate(d => {
            function remove(list) {
              const i = list.findIndex(x => x.id === id);
              if (i >= 0) { list.splice(i, 1); return true; }
              for (const x of list) if (x.children?.length && remove(x.children)) return true;
              return false;
            }
            remove(d.entries);
            d.history.unshift({ timestamp: new Date().toISOString(), itemId: id, action: 'item_deleted', details: `final: ${it.status}` });
          });
          setConfirm(null);
          triggerSave('Deleted');
        },
      });
    },
  };

  const submitItemDialog = (vals) => {
    if (itemDialog.mode === 'edit') {
      mutate(d => {
        const x = findItem(d.entries, itemDialog.itemId);
        if (!x) return;
        const before = { priority: x.priority, status: x.status };
        Object.assign(x, vals);
        if (before.status !== vals.status)
          d.history.unshift({ timestamp: new Date().toISOString(), itemId: x.id, action: 'status_changed', details: `${before.status} → ${vals.status}` });
        if (before.priority !== vals.priority)
          d.history.unshift({ timestamp: new Date().toISOString(), itemId: x.id, action: 'priority_changed', details: `${before.priority} → ${vals.priority}` });
      });
      triggerSave('Saved');
    } else {
      const newId = 'n-' + Math.random().toString(36).slice(2, 8);
      mutate(d => {
        const node = { id: newId, level: 1, ...vals, children: [], collapsed: false };
        if (itemDialog.mode === 'add-child' && itemDialog.parentId) {
          const parent = findItem(d.entries, itemDialog.parentId);
          if (parent) {
            parent.children = parent.children || [];
            node.level = (parent.level || 1) + 1;
            parent.children.push(node);
            setExpandedMap(m => ({ ...m, [parent.id]: true }));
          }
        } else {
          d.entries.push(node);
        }
        d.history.unshift({ timestamp: new Date().toISOString(), itemId: newId, action: 'item_created', details: vals.title });
      });
      triggerSave('Added');
    }
    setItemDialog(null);
  };

  const setExpanded = (id, val) => setExpandedMap(m => ({ ...m, [id]: val }));

  const tagsList = useMemoMain(() => allTags(data.entries),          [data]);
  const counts   = useMemoMain(() => countByStatus(data.entries),    [data]);

  const filtered = useMemoMain(() => {
    const f = { ...filters, text: filters.text?.trim() || '' };
    const noFilters = !f.statuses?.length && !f.priorities?.length && !f.tags?.length && !f.dueRange && !f.text;
    let tree = noFilters ? data.entries : filterTree(data.entries, f);
    tree = structuredClone(tree);
    if (tweaks.sort_mode === 'priority') {
      function sortRecur(list) {
        list.sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));
        list.forEach(it => it.children?.length && sortRecur(it.children));
      }
      sortRecur(tree);
    }
    if (f.scope === 'top') tree = tree.map(it => ({ ...it, children: [] }));
    return tree;
  }, [data, filters, tweaks.sort_mode]);

  const filteredCount = useMemoMain(() => countAll(filtered),       [filtered]);
  const totalCount    = useMemoMain(() => countAll(data.entries),    [data]);

  // ---- Keyboard shortcuts ----
  useEffectMain(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '/' && !e.metaKey) { e.preventDefault(); document.querySelector('.search-input')?.focus(); }
      if (e.key === 'g') setView('backlog');
      if (e.key === 'a') setView('admin');
      if (e.key === 'n') onMutate.addRoot();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Restore from backup ----
  const handleRestore = (b) => {
    setConfirm({
      title:    'Restore this backup?',
      danger:   false,
      message:  <>Overwrite <code className="mono">backlog.md</code> with the contents of this backup.</>,
      detail: (
        <>
          <div className="mono small">{b.name}</div>
          {!b.valid && (
            <div className="restore-warn">
              <Icon name="warn" size={14}/>
              <div>
                <div className="restore-warn-title">Checksum mismatch on this backup</div>
                <div className="restore-warn-body">The file may be partially written or edited externally.</div>
              </div>
            </div>
          )}
        </>
      ),
      confirmLabel: 'Restore',
      onConfirm: async () => {
        setConfirm(null);
        try {
          if (Storage.isConnected()) {
            const result = await Storage.restoreBackup(b.name);
            if (!result.ok) throw new Error(result.error || 'Restore failed');
            const [raw, backups, sizeInfo] = await Promise.all([Storage.load(), Storage.listBackups(), Storage.getHealthInfo()]);
            const parsed  = await Parser.parse(raw?.content || '');
            const newData = await buildDataFromStorage(parsed, backups, storageMode, sizeInfo);
            setData(newData);
            SyncPoller.lastChecksum = parsed.meta?.checksum || '';
            isDirtyRef.current = false;
          }
          showToast(`Restored from ${b.name.slice(0, 28)}…`);
        } catch (e) {
          showToast('Restore failed: ' + e.message, 'err');
        }
      },
    });
  };

  // ---- Import entries from parsed content ----
  const handleImport = ({ entries, history }) => {
    mutate(d => {
      d.entries = entries;
      if (history?.length) d.history = [...history, ...d.history];
      d.history.unshift({ timestamp: new Date().toISOString(), itemId: 'system', action: 'imported', details: `${entries.length} top-level entries` });
    });
    setImportExportOpen(false);
    triggerSave('Imported');
  };

  const saveLabel  = saveState.status === 'saving' ? 'Saving…'
                   : saveState.status === 'error'  ? 'Save failed'
                   : `Saved · ${fmtTimestamp(saveState.lastSaved)}`;
  const hasFilters = filters.text || filters.statuses?.length || filters.priorities?.length || filters.tags?.length || filters.dueRange;

  if (isLoading) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>Loading…</div>
          <div style={{ fontSize: 13 }}>Connecting to storage</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <StatusStyleContext.Provider value={tweaks.status_style}>
      <Header
        view={view} setView={setView}
        saveState={saveState} saveLabel={saveLabel}
        storageMode={storageMode}
        searchValue={filters.text}
        onSearch={(v) => setFilters({ ...filters, text: v })}
        onForceSave={() => triggerSave('Saved manually')}
        onOpenImportExport={() => setImportExportOpen(true)}
      />

      {storageMode === 'local' && (
        <div className="banner warn" style={{gap:8}}>
          <Icon name="warn" size={14}/>
          <span>
            This browser can't access local files directly — <strong>changes won't be saved.</strong>{' '}
            Open in Chrome or Edge to save without a server, or run{' '}
            <code className="mono">python3 server/server.py</code> for any browser.
          </span>
        </div>
      )}

      {needsConnect && (
        <div className="banner info">
          <Icon name="folder" size={14}/>
          No <code className="mono">backlog.md</code> connected — grant one-time folder access, then reloads are silent.
          <button className="btn-primary" style={{marginLeft:'auto',flexShrink:0,fontSize:12,padding:'3px 10px'}}
            onClick={handleConnect}>Open folder…</button>
        </div>
      )}

      {showWarning && (
        <div className="banner warn">
          <Icon name="warn" size={14}/>
          File was edited outside the app — checksum mismatch. The next save will rewrite a correct marker.
          <button className="banner-close" onClick={() => setShowWarning(false)}>dismiss</button>
        </div>
      )}

      {view === 'backlog' ? (
        <div className="main">
          <FilterPanel filters={filters} setFilters={setFilters} tagsList={tagsList} counts={counts}/>
          <section className="content">
            <div className="content-sticky">
              <div className="content-head">
                <div>
                  <div className="eyebrow">Backlog</div>
                  <h1 className="content-title">
                    {hasFilters ? <>{filteredCount} of {totalCount} items</> : <>{totalCount} items</>}
                  </h1>
                </div>
                <div className="content-head-actions">
                  <div className="seg seg-mini" title="Order">
                    <button className={`seg-btn ${tweaks.sort_mode === 'priority' ? 'active' : ''}`}
                      onClick={() => setTweak('sort_mode', 'priority')}>By priority</button>
                    <button className={`seg-btn ${tweaks.sort_mode === 'manual' ? 'active' : ''}`}
                      onClick={() => setTweak('sort_mode', 'manual')}>Manual</button>
                  </div>
                  <button className="btn-primary" onClick={onMutate.addRoot}>
                    <Icon name="plus" size={12}/> New item
                  </button>
                </div>
              </div>

              <ViewChips filters={filters} setFilters={setFilters}/>

              <div className="legend">
                <span className="legend-cap">Status:</span>
                {STATUSES.map(s => (
                  <span key={s.key} className="legend-item">
                    <StatusIcon status={s.key} size={13}/>
                    <span>{s.label}</span>
                  </span>
                ))}
                <span className="legend-sep">·</span>
                <span className="legend-hint">
                  {tweaks.sort_mode === 'manual' ? <>Drag rows to reorder · </> : <>Auto-sorted by priority · drag/arrows reorder within priority · </>}
                  <kbd>/</kbd> search · <kbd>n</kbd> new
                </span>
              </div>
            </div>

            <div className="content-scroll">
              {filtered.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-glyph">∅</div>
                  <div>{hasFilters ? 'No items match these filters.' : 'No items yet. Press n or click "+ New item" to start.'}</div>
                </div>
              ) : (
                <BacklogTree
                  items={filtered}
                  expandedMap={expandedMap}
                  setExpanded={setExpanded}
                  onMutate={onMutate}
                  query={filters.text?.trim() || ''}
                  statusStyle={tweaks.status_style}
                  manualOrder={tweaks.sort_mode === 'manual'}
                />
              )}
            </div>
          </section>
        </div>
      ) : (
        <AdminPage
          data={data}
          history={data.history}
          tweaks={tweaks}
          setTweak={setTweak}
          onClose={() => setView('backlog')}
          onForceSave={() => triggerSave('Force-saved')}
          onForceBackup={() => triggerSave('Force-backed up')}
          onCompact={() => {
            mutate(d => {
              if (d.history.length > 200) d.history = d.history.slice(0, 200);
            });
            triggerSave('History compacted');
          }}
          onRestore={handleRestore}
          onDownloadBackup={(name) => {
            if (Storage.mode === 'api') {
              const a = document.createElement('a');
              a.href     = `/api/backups/${encodeURIComponent(name)}`;
              a.download = name;
              a.click();
            } else {
              showToast(`${name.slice(0, 28)}… — download not available in direct mode`);
            }
          }}
        />
      )}

      <ItemDialog
        open={!!itemDialog}
        mode={itemDialog?.mode}
        initial={itemDialog?.initial}
        recentTags={recentTags}
        onClose={() => setItemDialog(null)}
        onSubmit={submitItemDialog}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        detail={confirm?.detail}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        onCancel={() => setConfirm(null)}
        onConfirm={confirm?.onConfirm}
      />

      <ImportExportDialog
        open={importExportOpen}
        data={data}
        storageMode={storageMode}
        onClose={() => setImportExportOpen(false)}
        onImport={handleImport}
      />

      {toast && (
        <div className={`toast ${toast.kind}`}><Icon name="check" size={12}/> {toast.msg}</div>
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection title="Status icons">
          <TweakRadio label="Style"
            value={tweaks.status_style}
            options={[
              { value: 'flat',  label: 'Flat'  },
              { value: 'ascii', label: 'ASCII' },
              { value: 'color', label: 'Color' },
              { value: 'emoji', label: 'Emoji' },
            ]}
            onChange={v => setTweak('status_style', v)}/>
        </TweakSection>
        <TweakSection title="Order">
          <TweakRadio label="Sort"
            value={tweaks.sort_mode}
            options={[
              { value: 'priority', label: 'By priority' },
              { value: 'manual',   label: 'Manual'      },
            ]}
            onChange={v => setTweak('sort_mode', v)}/>
        </TweakSection>
        <TweakSection title="Accent">
          <TweakSlider label="Hue" value={tweaks.accent_hue} min={0} max={360} step={1}
            onChange={v => setTweak('accent_hue', v)} formatValue={v => `${v}°`}/>
        </TweakSection>
        <TweakSection title="Layout">
          <TweakRadio label="Density"
            value={tweaks.density}
            options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
            onChange={v => setTweak('density', v)}/>
          <TweakToggle label="Paper texture" checked={tweaks.paper_texture} onChange={v => setTweak('paper_texture', v)}/>
        </TweakSection>
        <TweakSection title="Demo">
          <TweakButton label="Show checksum-mismatch banner"   onClick={() => setShowWarning(true)}/>
          <TweakButton label="Simulate external file change"   onClick={() => showToast('File reloaded from disk')}/>
          {window.SEED_DATA && (
            <TweakButton label="Load sample / test data" onClick={() => {
              const seed = structuredClone(window.SEED_DATA);
              const defaults = { done: 100, cancelled: 0, 'in-progress': 50, blocked: 25, postponed: 25, open: 0 };
              walkTree(seed.entries, it => {
                if (typeof it.progress !== 'number') it.progress = defaults[it.status] ?? 0;
                else if (it.status === 'done') it.progress = 100;
              });
              setData(seed);
              const em = {};
              walkTree(seed.entries, it => { em[it.id] = !it.collapsed; });
              setExpandedMap(em);
              showToast('Sample data loaded');
            }}/>
          )}
        </TweakSection>
      </TweaksPanel>
      </StatusStyleContext.Provider>
    </div>
  );
}

// ----- View chips (saved searches) -----
const VIEW_CHIPS = [
  { key: 'all',     label: 'All',         statuses: [] },
  { key: 'open',    label: 'Open',        statuses: ['open'] },
  { key: 'wip',     label: 'In progress', statuses: ['in-progress'] },
  { key: 'active',  label: 'Active',      statuses: ['open', 'in-progress', 'blocked', 'postponed'], hint: 'everything not done or cancelled' },
  { key: 'blocked', label: 'Blocked',     statuses: ['blocked'] },
  { key: 'closed',  label: 'Closed',      statuses: ['done', 'cancelled'], hint: 'done + cancelled' },
];

function ViewChips({ filters, setFilters }) {
  const cur = filters.statuses || [];
  const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const activeKey = VIEW_CHIPS.find(v => same(v.statuses, cur))?.key;
  return (
    <div className="view-chips" role="tablist" aria-label="Saved views">
      {VIEW_CHIPS.map(v => (
        <button key={v.key}
          role="tab"
          aria-selected={activeKey === v.key}
          className={`view-chip ${activeKey === v.key ? 'active' : ''}`}
          title={v.hint || v.label}
          onClick={() => setFilters({ ...filters, statuses: v.statuses })}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

// ----- Header -----
function Header({ view, setView, saveState, saveLabel, storageMode, searchValue, onSearch, onOpenImportExport }) {
  const modeIcon = storageMode === 'api' ? '⚡' : storageMode === 'direct' ? '📁' : '💾';
  return (
    <header className="header">
      <div className="brand">
        <span className="brand-glyph"><StatusIcon status="in-progress" size={16}/></span>
        <span className="brand-name">backlog</span>
        <span className="brand-sub mono" title={`Storage: ${storageMode}`}>backlog.md {modeIcon}</span>
      </div>

      <nav className="tabs">
        <button className={`tab ${view === 'backlog' ? 'active' : ''}`} onClick={() => setView('backlog')}>
          <Icon name="list" size={13}/> Backlog
        </button>
        <button className={`tab ${view === 'admin' ? 'active' : ''}`} onClick={() => setView('admin')}>
          <Icon name="cog" size={13}/> Admin
        </button>
      </nav>

      <div className="search-wrap">
        <Icon name="search" size={14}/>
        <input className="search-input"
          placeholder="Search titles, tags, reasons…  ( / )"
          value={searchValue}
          onChange={(e) => onSearch(e.target.value)}/>
        {searchValue && <button className="search-clear" onClick={() => onSearch('')}>×</button>}
      </div>

      <div className="header-right">
        <button className="header-btn" onClick={onOpenImportExport} title="Import / Export">
          <Icon name="archive" size={13}/> Import/Export
        </button>
        <div className={`save-indicator ${saveState.status}`}>
          <span className={`save-dot ${saveState.status}`}/>
          {saveLabel}
        </div>
      </div>
    </header>
  );
}

// ----- Import / Export dialog -----
function ImportExportDialog({ open, data, storageMode, onClose, onImport }) {
  const { useState: useStateD, useEffect: useEffectD, useRef: useRefD } = React;
  const [tab, setTab]         = useStateD('md');
  const [copied, setCopied]   = useStateD(false);
  const [mdContent, setMdContent] = useStateD('');
  const fileInputRef = useRefD(null);

  // Async-generate markdown when dialog opens or data changes.
  useEffectD(() => {
    if (!open || !data) return;
    let cancelled = false;
    Parser.serialize({ entries: data.entries, history: data.history })
      .then(md => { if (!cancelled) setMdContent(md); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, data]);

  const jsonContent = React.useMemo(() => {
    if (!data) return '';
    return JSON.stringify({ entries: data.entries, history: data.history, meta: data.meta }, null, 2);
  }, [data]);

  const currentContent = tab === 'md' ? mdContent : jsonContent;
  const filename       = tab === 'md' ? 'backlog.md' : 'backlog_export.json';
  const mimeType       = tab === 'md' ? 'text/markdown' : 'application/json';

  const copyContent = async () => {
    try { await navigator.clipboard.writeText(currentContent); }
    catch {
      const ta = Object.assign(document.createElement('textarea'), {
        value: currentContent, style: 'position:fixed;opacity:0',
      });
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const downloadFile = () => {
    const blob = new Blob([currentContent], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileInput = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      let entries, history;
      if (file.name.endsWith('.json')) {
        const obj = JSON.parse(text);
        entries = obj.entries || [];
        history = obj.history || [];
      } else {
        const parsed = await Parser.parse(text);
        entries = parsed.entries;
        history = parsed.history;
      }
      onImport({ entries, history });
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} width={760} labelledBy="dlg-ie-title">
      <DialogHeader id="dlg-ie-title" eyebrow="Backup & sync" title="Import / Export" onClose={onClose}/>
      <div className="dlg-body">
        <div className="ie-tabs">
          <button className={`ie-tab ${tab === 'md'   ? 'active' : ''}`} onClick={() => setTab('md')}>
            Markdown <span className="ie-tab-sub">.md</span>
          </button>
          <button className={`ie-tab ${tab === 'json' ? 'active' : ''}`} onClick={() => setTab('json')}>
            JSON <span className="ie-tab-sub">structured</span>
          </button>
          <button
            className={`ie-copy-btn ${copied ? 'copied' : ''}`}
            onClick={copyContent}
            title={`Copy ${tab === 'md' ? 'Markdown' : 'JSON'} to clipboard`}
            aria-live="polite"
          >
            {copied
              ? <><Icon name="check" size={13}/> <span>Copied</span></>
              : <><Icon name="copy"  size={13}/> <span>Copy</span></>}
          </button>
        </div>
        <pre className="export-pre">{currentContent || '…generating…'}</pre>
      </div>
      <div className="dlg-foot">
        <div>
          <input ref={fileInputRef} type="file" accept=".md,.json" style={{ display: 'none' }} onChange={handleFileInput}/>
          <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Icon name="upload" size={12}/> Import file…
          </button>
        </div>
        <div className="dlg-foot-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={downloadFile}>
            <Icon name="download" size={12}/> Download {tab === 'md' ? '.md' : '.json'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

window.App = App;
