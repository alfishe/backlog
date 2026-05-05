// Storage layer: Parser, ApiBackend, DirectBackend, Storage detection, SyncPoller.
// Compatible with web/index.html and server/server.py file format.
//
// File format (backlog.md):
//   # Backlog
//   <!-- SECTION: ENTRIES -->
//   - [ ] [P1] Title *(due: ..., reason: ..., tags: tag1 tag2, progress: 50)*
//     - [x] [P0] Child *(progress: 100)*
//   <!-- SECTION: HISTORY -->
//   | Timestamp | Item ID | Action | Details |
//   <!-- SECTION: INTEGRITY -->
//   <!-- saved: ... | checksum: sha256:... | entries: N | history: N -->

// ---- Parser ----
const Parser = {
  async parse(text) {
    if (!text || !text.trim()) {
      return { entries: [], history: [], meta: null, checksumOk: false };
    }

    const entStart  = text.indexOf('<!-- SECTION: ENTRIES -->');
    const histStart = text.indexOf('<!-- SECTION: HISTORY -->');
    const intStart  = text.indexOf('<!-- SECTION: INTEGRITY -->');

    const entriesText = entStart !== -1
      ? text.slice(entStart, histStart !== -1 ? histStart : intStart !== -1 ? intStart : text.length)
      : text;
    const historyText = histStart !== -1
      ? text.slice(histStart, intStart !== -1 ? intStart : text.length)
      : '';

    // Parse integrity marker
    let meta = null;
    let checksumOk = false;
    if (intStart !== -1) {
      const m = text.slice(intStart).match(
        /saved:\s*([^|]+?)\s*\|\s*checksum:\s*([^|]+?)\s*\|\s*entries:\s*(\d+)\s*\|\s*history:\s*(\d+)/
      );
      if (m) {
        meta = {
          saved:        m[1].trim(),
          checksum:     m[2].trim(),
          entryCount:   +m[3],
          historyCount: +m[4],
        };
        // Strip section-marker prefix + surrounding whitespace to get raw content,
        // matching server.py's compute_checksum() which uses raw (marker-free) payload.
        const rawEnt  = entriesText.slice('<!-- SECTION: ENTRIES -->'.length).trim();
        const rawHist = historyText.slice('<!-- SECTION: HISTORY -->'.length).trim();
        const payload = rawEnt + '\n' + rawHist;
        const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
        const hash = 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        checksumOk = hash === meta.checksum;
      }
    }

    // Parse history table
    const history = [];
    for (const line of historyText.split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const parts = line.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 4 && parts[0] !== 'Timestamp' && !parts[0].match(/^-+$/)) {
        history.push({ timestamp: parts[0], itemId: parts[1], action: parts[2], details: parts[3] });
      }
    }

    // Parse entries (indented markdown list)
    const GLYPH_MAP = { ' ': 'open', 'x': 'done', '!': 'blocked', '>': 'postponed', '/': 'in-progress', '-': 'cancelled' };
    let idSeq = Date.now();
    const uid = () => 'i-' + (++idSeq).toString(36);

    const entries = [];
    const stack = [{ children: entries, depth: -1, level: 0 }];

    for (const line of entriesText.split('\n')) {
      const m = line.match(/^(\s*)[-*]\s*\[([ x!>/\-])\]\s*(.*)$/);
      if (!m) continue;

      const depth  = m[1].length / 2;
      const status = GLYPH_MAP[m[2]] || 'open';
      const raw    = m[3].trim();

      let title = raw, due = null, reason = null, tags = [], priority = 'P1', progress = 0;

      const metaM = raw.match(/^(.*?)\s*\*\((.*)\)\*\s*$/);
      if (metaM) {
        title = metaM[1].trim();
        for (const p of metaM[2].split(',').map(s => s.trim())) {
          if      (p.startsWith('due:'))       due      = p.slice(4).trim();
          else if (p.startsWith('reason:'))    reason   = p.slice(7).trim();
          else if (p.startsWith('tags:'))      tags     = p.slice(5).trim().split(/\s+/).filter(Boolean);
          else if (p.startsWith('priority:'))  priority = p.slice(9).trim().toUpperCase();
          else if (p.startsWith('progress:'))  progress = parseInt(p.slice(9).trim(), 10) || 0;
        }
      }

      // Priority prefix [P0] embedded in title
      const pm = title.match(/^\[(P\d)\]\s*/);
      if (pm) { priority = pm[1]; title = title.slice(pm[0].length); }

      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      const parentLevel = stack[stack.length - 1].level;

      const item = {
        id: uid(),
        level: parentLevel + 1,
        title, status, priority, due, reason, tags,
        progress: status === 'done' ? 100 : progress,
        collapsed: false,
        children: [],
      };
      stack[stack.length - 1].children.push(item);
      stack.push({ children: item.children, depth, level: item.level });
    }

    return { entries, history, meta, checksumOk };
  },

  async serialize(data) {
    const entriesText = this._serializeEntries(data.entries);
    const historyText = this._serializeHistory(data.history);
    const payload  = entriesText + '\n' + historyText;
    const buf      = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    const hash     = 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const saved    = new Date().toISOString().slice(0, 19) + 'Z';
    const nEntries = this._countItems(data.entries);
    const nHistory = data.history.length;
    const marker   = `<!-- saved: ${saved} | checksum: ${hash} | entries: ${nEntries} | history: ${nHistory} -->`;
    return `# Backlog\n\n<!-- SECTION: ENTRIES -->\n\n${entriesText}\n\n<!-- SECTION: HISTORY -->\n\n${historyText}\n\n<!-- SECTION: INTEGRITY -->\n\n${marker}\n`;
  },

  _serializeEntries(items, depth = 0) {
    const indent = '  '.repeat(depth);
    const GLYPH  = { open: ' ', 'in-progress': '/', blocked: '!', postponed: '>', done: 'x', cancelled: '-' };
    const lines  = [];
    for (const it of items) {
      const meta = [];
      if (it.due)          meta.push(`due: ${it.due}`);
      if (it.reason)       meta.push(`reason: ${it.reason}`);
      if (it.tags?.length) meta.push(`tags: ${it.tags.join(' ')}`);
      if (it.priority && it.priority !== 'P1') meta.push(`priority: ${it.priority}`);
      if ((it.progress ?? 0) > 0) meta.push(`progress: ${it.progress}`);
      const metaStr = meta.length ? ` *(${meta.join(', ')})*` : '';
      const prefix  = it.priority ? `[${it.priority}] ` : '';
      lines.push(`${indent}- [${GLYPH[it.status] || ' '}] ${prefix}${it.title}${metaStr}`);
      if (it.children?.length) {
        lines.push(...this._serializeEntries(it.children, depth + 1).split('\n'));
      }
    }
    return lines.join('\n');
  },

  _serializeHistory(rows) {
    const lines = ['| Timestamp | Item ID | Action | Details |', '|-----------|---------|--------|---------|'];
    for (const r of rows) lines.push(`| ${r.timestamp} | ${r.itemId} | ${r.action} | ${r.details} |`);
    return lines.join('\n');
  },

  _countItems(items) {
    let n = 0;
    for (const it of items) { n++; n += this._countItems(it.children || []); }
    return n;
  },
};

// ---- API Backend (python server.py) ----
const ApiBackend = {
  async detect() {
    if (location.protocol === 'file:') return false; // no server in file:// context
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    try {
      const r = await fetch('/api/health', { signal: ctrl.signal });
      clearTimeout(t);
      return r.ok;
    } catch { clearTimeout(t); return false; }
  },

  async load() {
    const r = await fetch('/api/backlog');
    if (!r.ok) throw new Error('API load failed: ' + r.status);
    return r.json(); // { content, checksum }
  },

  async save(content) {
    const r = await fetch('/api/backlog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!r.ok) throw new Error('API save failed: ' + r.status);
    return r.json(); // { ok, checksum, saved }
  },

  async listBackups() {
    try {
      const r = await fetch('/api/backups');
      if (!r.ok) return [];
      return (await r.json()).backups || [];
    } catch { return []; }
  },

  async restoreBackup(name) {
    const r = await fetch('/api/backups/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return r.ok ? r.json() : { ok: false };
  },

  async getHealthInfo() {
    try {
      const r = await fetch('/api/health');
      if (!r.ok) return {};
      const j = await r.json();
      return {
        masterSize: j.masterSize || 0,
        statsSize: 0,
        masterPath: j.masterPath || '',
        backupsPath: j.backupsPath || '',
      };
    } catch { return {}; }
  },
};

// ---- Direct File Backend (File System Access API) ----
const DirectBackend = {
  dirHandle: null,
  _DB_NAME: 'pb-storage-v2',
  _STORE:   'handles',
  _KEY:     'root',

  async detect() {
    return typeof window.showDirectoryPicker === 'function';
  },

  // Silent reconnect — no user gesture. Returns true if the stored handle
  // is still accessible and permission is already granted.
  async tryAutoConnect() {
    this.dirHandle = await this._loadHandle();
    if (!this.dirHandle) return false;
    try {
      return (await this.dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch { return false; }
  },

  // Explicit connect — requires a user gesture (button click).
  // Shows the directory picker on first use; re-prompts for permission on subsequent uses.
  async connect() {
    let handle = await this._loadHandle();
    if (!handle) {
      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await this._saveHandle(handle);
    }
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('Permission denied');
    this.dirHandle = handle;
  },

  _loadHandle() {
    return new Promise(res => {
      const req = indexedDB.open(this._DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(this._STORE);
      req.onsuccess = e => {
        const get = e.target.result.transaction(this._STORE, 'readonly').objectStore(this._STORE).get(this._KEY);
        get.onsuccess = () => res(get.result || null);
        get.onerror   = () => res(null);
      };
      req.onerror = () => res(null);
    });
  },

  _saveHandle(handle) {
    return new Promise((res, rej) => {
      const req = indexedDB.open(this._DB_NAME, 1);
      req.onsuccess = e => {
        const tx = e.target.result.transaction(this._STORE, 'readwrite');
        tx.objectStore(this._STORE).put(handle, this._KEY);
        tx.oncomplete = () => res();
        tx.onerror    = () => rej(tx.error);
      };
    });
  },

  async _readFile(name) {
    try {
      const h = await this.dirHandle.getFileHandle(name);
      return (await h.getFile()).text();
    } catch { return null; }
  },

  async _writeFile(name, content, dirHandle) {
    const dir = dirHandle || this.dirHandle;
    const h = await dir.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(content);
    await w.close();
  },

  async load() {
    const content = await this._readFile('backlog.md');
    return { content: content || '', checksum: '' };
  },

  async save(content) {
    await this._writeFile('backlog.md', content);
    // Create backup
    try {
      const ts  = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const dir = await this.dirHandle.getDirectoryHandle('backups', { create: true });
      await this._writeFile(`backlog_${ts}.md`, content, dir);
    } catch { /* backup failure is non-fatal */ }
    return { ok: true };
  },

  async listBackups() {
    try {
      const dir     = await this.dirHandle.getDirectoryHandle('backups', { create: true });
      const backups = [];
      for await (const [name, h] of dir.entries()) {
        if (!name.startsWith('backlog_') || !name.endsWith('.md')) continue;
        const f = await h.getFile();
        const text = await f.text();
        backups.push({
          name,
          size:      f.size,
          timestamp: new Date(f.lastModified).toISOString(),
          valid:     text.includes('<!-- SECTION: INTEGRITY -->'),
        });
      }
      return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch { return []; }
  },

  async restoreBackup(name) {
    try {
      const dir  = await this.dirHandle.getDirectoryHandle('backups');
      const h    = await dir.getFileHandle(name);
      const text = await (await h.getFile()).text();
      await this._writeFile('backlog.md', text);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async getHealthInfo() {
    try {
      const f = await (await this.dirHandle.getFileHandle('backlog.md')).getFile();
      return { masterSize: f.size, statsSize: 0, dirName: this.dirHandle?.name ?? null };
    } catch { return { masterSize: 0, statsSize: 0, dirName: this.dirHandle?.name ?? null }; }
  },
};

// ---- Storage — detect backend and delegate ----
const Storage = {
  backend: null,
  mode: 'local', // 'api' | 'direct' | 'local'

  async detect() {
    if (await ApiBackend.detect()) {
      this.backend = ApiBackend;
      this.mode    = 'api';
      return 'api';
    }
    if (await DirectBackend.detect()) {
      this.backend = DirectBackend;
      this.mode    = 'direct';
      return 'direct';
    }
    this.mode = 'local';
    return 'local';
  },

  // Try to reconnect silently (no user gesture). Returns true if connected.
  // For API mode this is always true; for Direct it checks the stored handle.
  async tryAutoConnect() {
    if (this.backend === DirectBackend) return DirectBackend.tryAutoConnect();
    return true;
  },

  // Explicit connect — call from a user-gesture handler (button click).
  async connect() {
    if (this.backend === DirectBackend) await DirectBackend.connect();
  },

  // True only when a backend is detected AND fully initialised (dirHandle set for Direct).
  isConnected() {
    if (!this.backend) return false;
    if (this.backend === DirectBackend) return !!DirectBackend.dirHandle;
    return true;
  },

  async load()               { return this.backend?.load()                 ?? null; },
  async save(content)        { return this.backend?.save(content)           ?? null; },
  async listBackups()        { return this.backend?.listBackups()           ?? [];   },
  async restoreBackup(name)  { return this.backend?.restoreBackup(name)     ?? { ok: false }; },
  async getHealthInfo()      { return this.backend?.getHealthInfo?.()       ?? {};   },
};

// ---- SyncPoller — detect external file changes (5s interval) ----
const SyncPoller = {
  _timer:           null,
  lastChecksum:     '',
  _onExternalChange: null,
  _isDirty:          null,

  start({ onExternalChange, isDirty }) {
    this._onExternalChange = onExternalChange;
    this._isDirty          = isDirty;
    this._timer = setInterval(() => this._tick(), 5000);
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  async _tick() {
    if (Storage.mode === 'local' || !Storage.backend) return;
    try {
      const raw    = await Storage.load();
      if (!raw?.content) return;
      const parsed = await Parser.parse(raw.content);
      const cs     = parsed.meta?.checksum || '';
      if (!cs || cs === this.lastChecksum) return;
      this.lastChecksum = cs;
      if (this._isDirty?.()) {
        this._onExternalChange?.('warn', null);
      } else {
        this._onExternalChange?.('reload', parsed);
      }
    } catch { /* silent on poll errors */ }
  },
};

// ---- buildDataFromStorage — assemble the full App data object from parsed content ----
async function buildDataFromStorage(parsed, backups, storageMode, sizeInfo = {}) {
  const { entries, history, meta, checksumOk } = parsed;

  // Assign level field (derived from tree depth, not stored in file)
  function setLevels(items, level) {
    for (const it of items) {
      it.level = level;
      if (it.children?.length) setLevels(it.children, level + 1);
    }
  }
  setLevels(entries, 1);

  // Migrate: ensure progress field is always a number
  const progressDefaults = { done: 100, cancelled: 0, 'in-progress': 50, blocked: 25, postponed: 25, open: 0 };
  walkTree(entries, it => {
    if (typeof it.progress !== 'number') it.progress = progressDefaults[it.status] ?? 0;
    else if (it.status === 'done')       it.progress = 100;
  });

  // Status counts
  const statusMix = { open: 0, 'in-progress': 0, blocked: 0, postponed: 0, done: 0, cancelled: 0 };
  walkTree(entries, it => { statusMix[it.status] = (statusMix[it.status] || 0) + 1; });

  // Most active item by history event count
  const actCounts = {};
  walkTree(entries, it => { actCounts[it.id] = 0; });
  for (const h of history) { if (h.itemId in actCounts) actCounts[h.itemId]++; }
  const topId  = Object.entries(actCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topItem = topId ? findItem(entries, topId) : null;
  const mostActiveProject = topItem?.title || entries[0]?.title || '—';

  // Recent activity (last 7 days)
  const sevenAgo  = new Date(Date.now() - 7 * 86400000).toISOString();
  const recentH   = history.filter(h => h.timestamp >= sevenAgo);
  const createdThisWeek   = recentH.filter(h => h.action === 'item_created').length;
  const completedThisWeek = recentH.filter(h => h.action === 'status_changed' && h.details.includes('→ done')).length;

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const completionByDay = dayNames.map(day => ({ day, count: 0 }));
  const createdByDay    = dayNames.map(day => ({ day, count: 0 }));
  for (const h of recentH) {
    const dow = (new Date(h.timestamp).getDay() + 6) % 7; // 0=Mon
    if (h.action === 'status_changed' && h.details.includes('→ done'))  completionByDay[dow].count++;
    if (h.action === 'item_created')                                      createdByDay[dow].count++;
  }

  // Average days spent in-progress: pair "→ in-progress" with next "in-progress →" per item.
  const ipStart = {}; // itemId → start timestamp ms
  const ipDurations = [];
  for (const h of [...history].reverse()) { // chronological order
    if (h.action !== 'status_changed') continue;
    if (h.details.includes('→ in-progress'))     ipStart[h.itemId] = new Date(h.timestamp).getTime();
    else if (h.details.startsWith('in-progress →') && ipStart[h.itemId]) {
      const days = (new Date(h.timestamp).getTime() - ipStart[h.itemId]) / 86400000;
      if (days >= 0 && days < 365) ipDurations.push(days);
      delete ipStart[h.itemId];
    }
  }
  const avgInProgressDays = ipDurations.length > 0
    ? +(ipDurations.reduce((a, b) => a + b, 0) / ipDurations.length).toFixed(1)
    : null;

  const historyOldest = history.length > 0 ? history[history.length - 1].timestamp : null;
  const backupDirSize = backups.reduce((s, b) => s + (b.size || 0), 0);
  const historySize   = new TextEncoder().encode(JSON.stringify(history)).length;
  const modeLabel     = storageMode === 'api' ? 'API server'
                      : storageMode === 'direct' ? 'Direct (File System API)'
                      : 'localStorage only';

  return {
    entries,
    history,
    meta: meta || { saved: null, checksum: '—', entryCount: countAll(entries), historyCount: history.length },
    health: {
      integrityOk:   checksumOk,
      lastSave:      meta?.saved || null,
      lastBackup:    backups[0]?.timestamp || null,
      masterSize:    sizeInfo.masterSize   || 0,
      backupDirSize,
      backupCount:   backups.length,
      statsSize:     sizeInfo.statsSize    || 0,
      historySize,
      historyOldest,
      mode:          modeLabel,
      masterPath:    sizeInfo.masterPath  || (sizeInfo.dirName ? `${sizeInfo.dirName}/backlog.md` : null),
      backupsPath:   sizeInfo.backupsPath || (sizeInfo.dirName ? `${sizeInfo.dirName}/backups/`   : null),
    },
    stats: {
      createdThisWeek,
      completedThisWeek,
      avgInProgressDays,
      mostActiveProject,
      completionByDay,
      createdByDay,
      statusMix,
    },
    backups,
  };
}

Object.assign(window, {
  Parser,
  ApiBackend,
  DirectBackend,
  Storage,
  SyncPoller,
  buildDataFromStorage,
});
