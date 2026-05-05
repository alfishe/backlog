# Technical Design Document — Personal Backlog

## 1. Overview

This document describes the full technical implementation of the Personal Backlog application — a single-user, locally-hosted task manager backed by a single Markdown file. It covers both the HTML frontend implementations (v1 vanilla JS and v2 React 18), the Python server, the bundling pipeline, and the data contract that ties them together.

## 2. Source Code Structure

```
personal-backlog/
├── server/
│   └── server.py                 # Python REST API server (~420 LoC)
│
├── web/                          # V2 source code (React 18 + JSX) + build tooling
│   ├── index.html                # Dev entry point (React + Babel from CDN)
│   ├── styles.css                # All CSS
│   ├── storage.jsx               # Parser, ApiBackend, DirectBackend, Storage, SyncPoller
│   ├── helpers.jsx               # walkTree, findItem, useTweaks hook, event utilities
│   ├── app.jsx                   # Root <App> component, state, save/load lifecycle
│   ├── tree.jsx                  # <TreeItem> recursive component
│   ├── dialogs.jsx               # Modal dialogs (add/edit/delete/import/export)
│   ├── admin.jsx                 # Admin dashboard page
│   ├── filter-panel.jsx          # Left sidebar: status/priority/tag/date filters
│   ├── tweaks-panel.jsx          # Settings panel (density, accent hue, status style)
│   ├── data.jsx                  # Seed data for testing (not loaded by default)
│   ├── bundle.js                 # Build tool: multi-file JSX → single-file HTML
│   ├── package.json              # Declares @babel/core, @babel/preset-react
│   └── node_modules/
│
├── webapp/                       # Built output — ready to open or deploy
│   └── index-style-v2.html      # Self-contained single-file SPA (~348 KB)
│
├── design/
│   ├── design-v1/                # V1 source (archived, vanilla JS)
│   └── archive/                  # Earlier prototypes
│
└── doc/
    ├── requirements/requirements.md
    └── architecture/
        ├── architecture.md
        └── tdd.md                # This file
```

## 3. Data Contract — `backlog.md` Format

The Markdown file is the sole source of truth. Both the Python server and the JavaScript frontend must parse and produce this exact format.

### 3.1 File Structure

```markdown
# Backlog

<!-- SECTION: ENTRIES -->

- [ ] [P0] Task title *(due: 2025-06-01, priority: P0, progress: 50)*
  - [x] [P1] Sub-task *(priority: P1, progress: 100)*
- [!] [P1] Blocked task *(priority: P1, reason: waiting for API keys)*

<!-- SECTION: HISTORY -->

| Timestamp | Item ID | Action | Details |
|-----------|---------|--------|---------|
| 2025-05-10T14:32:00Z | i-m1 | status_changed | open → done |

<!-- SECTION: INTEGRITY -->

<!-- saved: 2025-05-10T14:35:12Z | checksum: sha256:abc123... | entries: 42 | history: 128 -->
```

Three mandatory section markers: `<!-- SECTION: ENTRIES -->`, `<!-- SECTION: HISTORY -->`, `<!-- SECTION: INTEGRITY -->`.

### 3.2 Entry Line Format

```
<indent>- [<glyph>] [<priority>] <title> *(<metadata>)*
```

| Part | Format | Example |
|------|--------|---------|
| Indent | 2 spaces per level | `  ` (level 2) |
| Glyph | `[ ]` `[x]` `[!]` `[>]` `[/]` `[-]` | `[x]` |
| Priority prefix | `[P0]` through `[P3]`, followed by space | `[P0] ` |
| Title | Free text | `Ship landing page` |
| Metadata | `*(key: value, ...)*` | `*(due: 2025-06-01, progress: 50)*` |

**Glyph-to-status mapping:**

| Glyph | Status |
|-------|--------|
| `[ ]` | `open` |
| `[/]` | `in-progress` |
| `[!]` | `blocked` |
| `[>]` | `postponed` |
| `[x]` | `done` |
| `[-]` | `cancelled` |

**Metadata keys** (all optional, comma-separated inside `*(...)*`):

| Key | Value format | Default |
|-----|-------------|---------|
| `due` | ISO date `YYYY-MM-DD` | null |
| `priority` | `P0`–`P3` | `P1` |
| `progress` | Integer `0–100` | `0` |
| `reason` | Free text (for blocked items) | null |
| `tags` | Space-separated words | [] |

### 3.3 Checksum Algorithm

```
payload = entries_section_text.trim() + "\n" + history_section_text.trim()
hash = "sha256:" + SHA-256(UTF-8(payload))
```

The `entries_section_text` is everything between `<!-- SECTION: ENTRIES -->` and `<!-- SECTION: HISTORY -->`, excluding the markers themselves. Similarly for history. The integrity marker comment is excluded from the hash.

**Policy:** On save, the writer computes and writes the hash. On load, the reader verifies it. Mismatch = yellow warning banner, never blocks loading. Next save overwrites with the correct hash.

### 3.4 Parser Regex (Critical Implementation Detail)

The parser extracts metadata from entry lines using this regex:

```javascript
const metaM = raw.match(/^(.*?)\s*\*\((.*)\)\*\s*$/);
```

This matches the `*(...)*` wrapper at the end of a line. The trailing `\*\s*$` is essential — the metadata format wraps with `)*` (paren + asterisk), not just `)`. A previous bug where the regex ended with `\)\s*$` caused the entire metadata string to be absorbed into the title on every save/load cycle.

The priority prefix is extracted separately:

```javascript
const pm = title.match(/^\[(P\d)\]\s*/);
if (pm) { priority = pm[1]; title = title.slice(pm[0].length); }
```

### 3.5 Serializer Output Format

The serializer writes entries in this format:

```
<indent>- [<glyph>] [<priority>] <title> *(<metadata>)*
```

**Serialization rules:**
- Priority prefix `[Pn]` is always written before the title
- Metadata `*(...)*` is appended only when at least one metadata field is non-default
- `priority: P1` is omitted from metadata (it's the default, already shown as prefix)
- `progress: 0` is omitted from metadata (default)
- `progress` is only included when > 0

## 4. Frontend Implementation — V2 (React 18)

### 4.1 Component Tree

```
<App>
  ├── <FilterPanel>         (left sidebar)
  ├── Main area
  │   ├── Header + search bar
  │   ├── <TreeItem> (recursive, one per entry)
  │   │   └── <TreeItem> ... (children)
  │   └── Add-item button
  ├── <AdminPage>           (gear icon route)
  │   ├── System Health card
  │   ├── Storage card (with filesystem paths)
  │   ├── Backup Browser
  │   ├── Stats Overview
  │   └── Manual Actions
  ├── <TweaksPanel>         (settings slide-out)
  ├── <ItemDialog>          (add/edit modal)
  ├── <ConfirmDialog>       (confirmation modal)
  └── <ImportExportDialog>  (import/export modal)
```

### 4.2 State Management

All state lives in `App` component via React hooks. No external state library.

```javascript
const [data, setData]             = useState(buildEmptyData);
const [storageMode, setStorageMode] = useState('local');  // 'api' | 'direct' | 'local'
const [filters, setFilters]       = useState({statuses, priorities, tags, dueRange, scope, text});
const [expandedMap, setExpandedMap] = useState({});        // id → bool
const [saveState, setSaveState]   = useState({status, lastSaved});
```

**Key invariant:** `data` always reflects the latest saved or loaded state. `isDirtyRef` tracks whether there are unsaved local edits (for conflict detection).

Only UI state (expanded/collapsed map) is persisted to `localStorage`. Backlog data is always sourced from `backlog.md`.

### 4.3 Data Flow

```
User action (edit, status change, reorder)
    │
    ▼
Mutate data object → setData(newData)
    │
    ├─► Immediate re-render (React)
    │
    └─► Debounced save (300ms)
         │
         ▼
        Parser.serialize(data) → markdown string
         │
         ▼
        Storage.save(markdown) → backend writes to disk
         │
         ▼
        SyncPoller.lastChecksum updated
```

### 4.4 Storage Module (`storage.jsx`)

This is the infrastructure layer — all filesystem access is routed through here.

#### Parser

The `Parser` object provides `parse(text)` and `serialize(data)`:

- **`parse(text)`** — Splits text by section markers, parses entries into a tree, parses history table rows, verifies checksum. Returns `{ entries, history, meta, checksumOk }`.
- **`serialize(data)`** — Rebuilds markdown from the tree, recomputes SHA-256, writes integrity marker. Returns the full markdown string.

Both are async because they use `crypto.subtle.digest()` for SHA-256.

#### Storage Backend Detection

```javascript
Storage.detect() → 'api' | 'direct' | 'local'
```

Detection order:
1. Probe `GET /api/health` with 800ms timeout → `ApiBackend`
2. Check `typeof window.showDirectoryPicker === 'function'` → `DirectBackend`
3. Fall back to `'local'` (localStorage-only, no persistence)

#### ApiBackend

| Method | HTTP | Endpoint |
|--------|------|----------|
| `load()` | `GET` | `/api/backlog` → `{ content, checksum }` |
| `save(content)` | `POST` | `/api/backlog` body `{ content }` → `{ ok, checksum, saved }` |
| `listBackups()` | `GET` | `/api/backups` → `{ backups: [...] }` |
| `restoreBackup(name)` | `POST` | `/api/backups/restore` body `{ name }` → `{ ok }` |
| `getHealthInfo()` | `GET` | `/api/health` → `{ masterSize, backupCount, masterPath, backupsPath, ... }` |

In API mode, `location.protocol` must not be `file:` — detection skips API when opening the HTML file directly.

#### DirectBackend

Uses the File System Access API (Chrome/Edge only):

| Operation | Implementation |
|-----------|---------------|
| Directory handle persistence | IndexedDB (`pb-storage-v2` → `handles` → `root`) |
| Auto-reconnect | `dirHandle.queryPermission({ mode: 'readwrite' })` — silent, no user gesture |
| Manual connect | `dirHandle.requestPermission({ mode: 'readwrite' })` — requires user gesture |
| Read file | `dirHandle.getFileHandle('backlog.md').getFile().text()` |
| Write file | `dirHandle.getFileHandle('backlog.md', {create:true}).createWritable()` |
| List backups | Iterate `dirHandle.getDirectoryHandle('backups')` entries |
| Write backup | Write to `backups/backlog_YYYY-MM-DD-HH-mm-ss.md` |

**Reset:** Delete the `pb-storage-v2` IndexedDB database, then reload the page.

#### SyncPoller

Polls every 5 seconds via `Storage.load()`. Compares the checksum from the loaded content against `lastChecksum`:

- **Checksum unchanged** → no-op
- **Checksum changed, no local edits** → auto-reload, show toast
- **Checksum changed, local edits exist** → show warning toast ("File changed externally — you have unsaved edits")

### 4.5 App Initialization Flow

```
App mounts
    │
    ▼
Storage.detect()
    │
    ├─► 'api' ─► applyStorageData()
    │                │
    │                ├─ Storage.load()
    │                ├─ Storage.listBackups()
    │                ├─ Storage.getHealthInfo()
    │                ├─ Parser.parse(content)
    │                ├─ buildDataFromStorage()
    │                ├─ setData(newData)
    │                └─ SyncPoller.start()
    │
    ├─► 'direct' ─► tryAutoConnect()
    │                   │
    │                   ├─ success ─► applyStorageData() (same as api)
    │                   └─ fail ─► setNeedsConnect(true), show connect button
    │
    └─► 'local' ─► setIsLoading(false), use empty data
```

**`isCancelled` pattern:** The `applyStorageData` function accepts an `isCancelled` function (not a boolean) so it can check the cancellation state after each async operation. This prevents setting state on an unmounted component:

```javascript
await applyStorageData(mode, () => cancelled);
```

### 4.6 buildDataFromStorage

This function assembles the complete data object consumed by the UI:

```javascript
async function buildDataFromStorage(parsed, backups, storageMode, sizeInfo)
```

Returns:
```javascript
{
  entries,      // Hierarchical task tree with levels assigned
  history,      // Audit log rows
  meta,         // Integrity marker data
  health: {
    integrityOk, lastSave, lastBackup, masterSize, backupDirSize,
    backupCount, statsSize, historySize, historyOldest,
    mode,        // 'API server' | 'Direct (File System API)' | 'localStorage only'
    masterPath,  // Filesystem path (API mode only, null otherwise)
    backupsPath, // Backup directory path (API mode only, null otherwise)
  },
  stats: {
    createdThisWeek, completedThisWeek, avgInProgressDays,
    mostActiveProject, completionByDay, createdByDay, statusMix,
  },
  backups,      // Backup file list with metadata
}
```

**Progress migration:** When loading, items with missing or non-numeric `progress` get default values based on their status (done→100, in-progress→50, blocked→25, etc.). Items with `status === 'done'` are always forced to `progress: 100`.

## 5. Frontend Implementation — V1 (Vanilla JS, archived)

The V1 implementation is archived at `design/archive/index-v1.html` as a single self-contained file (~41 KB). It uses vanilla JavaScript with direct DOM manipulation — no React, no virtual DOM, no build step.

### 5.1 Architecture

The V1 follows the same three-layer architecture (Presentation → Domain → Infrastructure) but all modules are inlined in a single `<script>` block within the HTML file. Key modules:

| Module | Role |
|--------|------|
| `Parser` | Parse/serialize markdown (identical logic to V2) |
| `Store` | In-memory state, mutations, change events |
| `Renderer` | DOM tree rendering |
| `Storage` | Backend detection and routing |
| `ApiBackend` | HTTP fetch to server API |
| `DirectBackend` | File System Access API |

The V1 Parser uses the same regex for metadata extraction:
```javascript
const metaM = raw.match(/^(.*?)\s*\*\((.*)\)\*\s*$/);
```

### 5.2 Differences from V2

| Aspect | V1 | V2 |
|--------|----|----|
| Framework | Vanilla JS | React 18 |
| DOM updates | Direct manipulation | React reconciliation |
| Source files | Single HTML file | Multi-file JSX + CSS |
| CSS | Inline `<style>` | External `styles.css` (42 KB) |
| Bundle size | ~41 KB | ~346 KB |
| Admin page | Basic | Full dashboard with stats |
| Filter panel | Simple | Advanced with tag autocomplete |
| Settings | None | Tweaks panel (density, accent hue, etc.) |

Both versions use the same `backlog.md` format and are compatible with both storage backends.

## 6. Python Server (`server.py`)

### 6.1 Overview

A single-file HTTP server (~420 LoC) built on Python 3's `http.server` module. Zero external dependencies — only stdlib imports.

### 6.2 Configuration

```python
class Config:
    dir           # Root data directory (resolved Path)
    port          # Listen port
    master        # Path to backlog.md
    backups_dir   # Path to backups/
    stats_file    # Path to stats.jsonl
    web_dir       # Path to web/ (static files to serve)
```

Command-line arguments:
- `--port` (default: 8080) — Listen port
- `--dir` (default: directory of server.py) — Data directory
- `--web-dir` (default: `../webapp/`) — Static file directory

### 6.3 REST API

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `GET` | `/api/health` | — | `{ status, lastSave, lastBackup, masterSize, backupCount, masterPath, backupsPath }` |
| `GET` | `/api/backlog` | — | `{ content, checksum }` |
| `POST` | `/api/backlog` | `{ content }` | `{ ok, checksum, saved }` |
| `GET` | `/api/backups` | — | `{ backups: [{ name, size, timestamp, valid }] }` |
| `GET` | `/api/backups/<name>` | — | Raw markdown file download |
| `POST` | `/api/backups/restore` | `{ name }` | `{ ok }` |
| `POST` | `/api/export` | `{ format: "json" \| "markdown" }` | JSON dump or raw markdown |
| `POST` | `/api/import` | `{ content }` | `{ ok }` |
| `POST` | `/api/stats` | `{ event, payload }` | `{ ok }` |
| `GET` | `/api/stats?from=&to=` | — | `{ events: [...] }` |

Non-API paths serve static files from `web_dir` with MIME type detection. The root path `/` serves `web_dir/index.html`.

### 6.4 Atomic Write Sequence

```
1. Write content to backlog.md.tmp
2. Parse tmp file to verify it's structurally valid
3. Copy tmp → backups/backlog_YYYY-MM-DD_HH-MM-SS-mmm.md
4. Run backup rotation (prune old files)
5. Atomic rename: tmp → backlog.md
6. Append save_completed event to stats.jsonl
7. Return { ok: true, checksum, saved }
```

### 6.5 Backup Rotation

```python
def rotate_backups():
    # Keep all backups ≤ 7 days old
    # After 7 days: keep only the newest backup per calendar day
    # Never delete the single most recent backup
```

### 6.6 CORS & Security

- All responses include `Access-Control-Allow-Origin: *` (single-user local tool, no CSRF protection)
- `OPTIONS` requests return `204 No Content` with CORS headers
- Server binds to `0.0.0.0` for LAN access (phone/tablet)
- Path traversal protection: static file requests are resolved against `web_dir` and checked with `relative_to()`
- No authentication — intentional for a personal local tool

### 6.7 Stats File (`stats.jsonl`)

Append-only JSON Lines file:

```jsonl
{"t":"2025-05-10T14:32:01Z","e":"item_created","d":{"id":"task-1","level":3,"project":"proj-1"}}
{"t":"2025-05-10T14:35:00Z","e":"save_completed","d":{"size":12400,"ms":45}}
```

Fields: `t` (ISO timestamp), `e` (event type), `d` (payload).

## 7. Bundling Pipeline

### 7.1 Purpose

The V2 source code is split across multiple JSX and CSS files for developer ergonomics. The bundler collapses everything into a single HTML file that can be opened offline with zero setup.

### 7.2 Bundle Script (`bundle.js`)

Location: `web/bundle.js` (~234 LoC)

**Prerequisites:**
- Node.js 18+ (uses global `fetch` for CDN downloads)
- `npm install` in `web/` directory (installs `@babel/core` + `@babel/preset-react`)

**Usage:**
```bash
cd web
node bundle.js index.html ../webapp/index-style-v2.html
```

### 7.3 Bundle Process (Step by Step)

```
1. Read index.html

2. Inline stylesheets:
   For each <link rel="stylesheet" href="...">:
     - If local file: replace with <style>...</style>
     - If remote URL: keep as-is
   ✓ styles.css → <style>

3. Process scripts:
   For each <script src="...">:
     a) Remote CDN with a swap rule:
        - React dev → fetch React production min, inline as <script>
        - ReactDOM dev → fetch ReactDOM production min, inline as <script>
        - @babel/standalone → remove entirely (no longer needed)
     b) Local file with type="text/babel":
        - Read file content
        - Compile JSX → plain JS via @babel/core + @babel/preset-react
        - Strip type="text/babel" attribute
        - Inline as <script>...</script>
     c) Local file without babel:
        - Read and inline as <script>...</script>
     d) Remote URL with no swap rule:
        - Keep as-is
   ✓ helpers.jsx (JSX→JS)
   ✓ storage.jsx (JSX→JS)
   ✓ tweaks-panel.jsx (JSX→JS)
   ✓ filter-panel.jsx (JSX→JS)
   ✓ tree.jsx (JSX→JS)
   ✓ dialogs.jsx (JSX→JS)
   ✓ admin.jsx (JSX→JS)
   ✓ app.jsx (JSX→JS)

4. Compile inline babel blocks:
   For each <script type="text/babel">...</script>:
     - Compile JSX → JS
     - Strip type="text/babel" attribute
   ✓ ReactDOM.createRoot boot script

5. Write output file
```

### 7.4 CDN Swap Table

| Source CDN URL | Action |
|---------------|--------|
| `unpkg.com/react-dom@*` | Fetch `react-dom.production.min.js`, inline |
| `unpkg.com/react@*` | Fetch `react.production.min.js`, inline |
| `unpkg.com/@babel/standalone@*` | Remove tag entirely |

Production builds are smaller than development builds. The Babel compiler is removed because all JSX has been pre-compiled.

### 7.5 HTML Comment Awareness

The bundler skips all processing for content inside HTML comments (`<!-- ... -->`). This means commented-out `<script>` or `<link>` tags are left untouched, which is important for the data.jsx seed script that is commented out by default in `index.html`.

### 7.6 Script Escaping

Content inlined into `<script>` tags has `</script>` replaced with `<\/script>` to prevent the browser from prematurely closing the script block. Similarly, `</style>` is escaped in inlined CSS.

## 8. Key Data Structures

### 8.1 Entry Item

```javascript
{
  id:          "i-m1abc",      // Unique ID: "i-" + base36 counter
  level:       1,              // 1–4 (Area→Project→Task→Sub-task)
  title:       "Ship landing page",
  status:      "open",         // open | in-progress | blocked | postponed | done | cancelled
  priority:    "P0",           // P0 | P1 | P2 | P3
  due:         "2025-06-01",   // ISO date or null
  reason:      null,           // Free text (blocked items)
  tags:        ["urgent"],     // Array of strings
  progress:    50,             // 0–100 integer
  collapsed:   false,          // UI expand/collapse state
  children:    [],             // Nested entry items
}
```

### 8.2 History Row

```javascript
{
  timestamp: "2025-05-10T14:32:00Z",
  itemId:    "i-m1abc",
  action:    "status_changed",  // status_changed | item_created | item_deleted | item_moved
  details:   "open → done",
}
```

### 8.3 Integrity Meta

```javascript
{
  saved:        "2025-05-10T14:35:12Z",
  checksum:     "sha256:abc123...",
  entryCount:   42,
  historyCount: 128,
}
```

## 9. Cross-Version Compatibility

### 9.1 V1 ↔ V2

Both versions read and write the same `backlog.md` format. They can be used interchangeably against the same data file. The V2 file (`webapp/index-style-v2.html`) can be served by the Python server or opened directly in Chrome/Edge. The archived V1 file (`design/archive/index-v1.html`) is no longer actively maintained.

### 9.2 API Server ↔ Direct File Access

Both storage backends read/write the same `backlog.md` file on disk. The only difference is *how* they access it:

| Aspect | API Server | Direct File Access |
|--------|-----------|-------------------|
| Read | `GET /api/backlog` → JSON | `dirHandle.getFileHandle().getFile().text()` |
| Write | `POST /api/backlog` ← JSON | `dirHandle.getFileHandle({create:true}).createWritable()` |
| Backup | Server-side copy | Frontend writes to `backups/` dir handle |
| Health | `GET /api/health` | Read file size from `getFile()` |
| Paths shown | Yes (server knows filesystem) | No (browser doesn't expose paths) |

### 9.3 Switching Modes

To switch from API server to direct file access:
1. Stop the server
2. Open `webapp/index-style-v2.html` in Chrome/Edge
3. Select the folder containing your `backlog.md`

To switch from direct file access to API server:
1. Note the folder path where `backlog.md` lives
2. Start `python3 server/server.py --dir /that/folder`
3. Open `http://localhost:8080`

**Important:** Never run both modes simultaneously against the same file — last writer wins.

## 10. Performance Considerations

| Metric | Target | Implementation |
|--------|--------|---------------|
| Initial load | < 1s for ≤1MB file | Single-pass parser, async SHA-256 |
| Save latency | < 300ms | Atomic rename (server), writable stream (direct) |
| Poll overhead | Negligible | 5s interval, checksum comparison, short-circuits on match |
| Render | < 50ms for 500 items | React reconciliation, targeted updates |
| Bundle size | < 400 KB | Production React builds, no source maps |

## 11. Known Limitations

1. **File System Access API** is Chrome/Edge only. Firefox and Safari users must use the Python server.
2. **No concurrent access protection.** If two browser tabs or a browser + external editor write simultaneously, the last writer wins. The SyncPoller detects external changes but cannot prevent race conditions.
3. **No dark mode** yet. CSS custom properties are used throughout, making it a one-line toggle when needed.
5. **DirectBackend backup rotation** does not prune old backups — only the API server does rotation.
