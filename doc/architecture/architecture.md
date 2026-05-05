# Personal Backlog — Architecture

## 1. Philosophy

> **One deliverable.** The app ships as a single self-contained HTML file (`webapp/index-style-v2.html`). It talks to the filesystem either through a minimal localhost Python server **or** directly via the browser's File System Access API — no cloud, no accounts, no external CDNs at runtime.
>
> The user chooses the mode by how they open the app: run `python3 server/server.py` for universal browser support, or open the HTML file directly in Chrome/Edge for a zero-install experience.
>
> *The source code lives in `web/` as React 18 + JSX files and is compiled to the single-file artifact by `web/bundle.js`. The build step is only needed when changing source; users only ever touch the output.*

## 2. Deployment Topology

### Mode A — API Server (universal browsers)
```
┌─────────────────────────────────────┐
│  Browser (Chrome / Firefox / Safari)│
│  ─────────────────────────────────  │
│  Single self-contained HTML file    │
│  ├─ inline CSS                      │
│  ├─ inline React 18 + app JS        │
│  └─ inline SVG icons                │
└──────────────┬──────────────────────┘
               │ HTTP (localhost)
┌──────────────▼──────────────────────┐
│  Python File Server (~420 LoC)      │
│  Python 3 stdlib, zero pip deps     │
│  Serves HTML + REST API for disk    │
└──────────────┬──────────────────────┘
               │ read / write / watch
    ┌──────────┼──────────┐
    ▼          ▼          ▼
backlog.md  backups/   stats.jsonl
(master)    (rotating) (append-only)
```

### Mode B — Direct File Access (Chrome/Edge, zero server)
```
┌────────────────────────────────────────┐
│  Browser (Chrome / Edge)               │
│  ────────────────────────────────────  │
│  HTML file opened via file:// or       │
│  served by any static file server      │
│  ├─ inline CSS                         │
│  ├─ inline React 18 + app JS           │
│  └─ inline SVG icons                   │
└──────────────┬─────────────────────────┘
               │ File System Access API
               │ (showDirectoryPicker)
    ┌──────────┼──────────┐
    ▼          ▼          ▼
backlog.md  backups/   stats.jsonl
(master)    (rotating) (append-only)
```

> **Note:** Firefox and Safari do not support the File System Access API. Opening the HTML file directly in those browsers starts the app in read-only mode with a warning banner. Use Mode A (Python server) for full functionality in any browser.

## 3. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Frontend runtime** | React 18 (production UMD, inlined) | Component model for complex UI; inlined so there are no runtime CDN requests. |
| **Frontend source** | JSX + CSS in `web/` | Multi-file development ergonomics; compiled to single HTML by bundler. |
| **Build tooling** | `bundle.js` + `@babel/core` | Pre-compiles JSX, inlines prod React builds, removes Babel. Dev-only dependency. |
| **Styling** | External `styles.css` (inlined at build) | Edited as plain CSS; inlined into the bundle so the output file is self-contained. |
| **Icons / graphics** | Inline SVG | Scalable, styleable with CSS, no network requests. |
| **Server (API mode)** | Python 3 `http.server` | Ships with macOS/Linux/Windows; zero pip installs. |
| **Server (Direct mode)** | File System Access API | Native browser API for Chrome/Edge; zero install. Not available in Firefox/Safari. |
| **Master storage** | Markdown file (`backlog.md`) | Human-readable, diff-friendly, matches requirements exactly. |
| **Backup storage** | Filesystem directory (`backups/`) | Simple rotation via filename sorting. |
| **Stats storage** | JSONL file (`stats.jsonl`) | Append-only, no locking complexity, human-readable, trivial to parse. |
| **Transport** | HTTP/1.1 + JSON | Universally supported, trivial to debug with curl. |

## 4. Frontend Architecture

The source code is split across files in `web/` and compiled to a single self-contained HTML file in `webapp/`. Logical modules are organized into three layers so that UI components and business logic never know which storage backend is active.

### 4.1 Layered Module Map

```
┌─────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER                                         │
│  ─────────────────                                          │
│  <App>, <TreeItem>, <AdminPage>, <FilterPanel>,             │
│  <TweaksPanel>, <ItemDialog>, <ConfirmDialog>,              │
│  <ImportExportDialog>                                       │
│  React components — only read/write data through props      │
│  and callbacks passed down from App.                        │
├─────────────────────────────────────────────────────────────┤
│  DOMAIN / BUSINESS LOGIC LAYER                              │
│  ────────────────────────────                               │
│  Parser, buildDataFromStorage, filter logic in App          │
│  Parse markdown → data tree; serialize data tree → markdown │
│  Compute stats, enforce Parent Visibility Rule.             │
├─────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE LAYER                                       │
│  ────────────────────                                       │
│  Storage, ApiBackend, DirectBackend, SyncPoller             │
│  Route reads/writes to disk (API or File System API).       │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Source File Reference

| File | Layer | Responsibility |
|------|-------|----------------|
| `app.jsx` | App | Root `<App>` component. All state lives here via React hooks. Storage init, save/load lifecycle, filter state, debounced autosave. |
| `storage.jsx` | Infrastructure + Domain | `Parser` (parse/serialize markdown), `ApiBackend`, `DirectBackend`, `Storage` (detect + delegate), `SyncPoller`, `buildDataFromStorage`. |
| `tree.jsx` | Presentation | Recursive `<TreeItem>` component. Expand/collapse, drag-and-drop reorder, status glyphs, progress bars. |
| `admin.jsx` | Presentation | `<AdminPage>` — health card, storage stats, backup browser, stats chart, manual actions. |
| `filter-panel.jsx` | Presentation | Left sidebar: status/priority/tag/date filters with multi-select. |
| `tweaks-panel.jsx` | Presentation | Settings slide-out: density, accent hue, status glyph style. |
| `dialogs.jsx` | Presentation | `<ItemDialog>`, `<ConfirmDialog>`, `<ImportExportDialog>`. |
| `helpers.jsx` | Domain | `walkTree`, `findItem`, `countAll`, `countByStatus`, `useTweaks` hook, formatting utilities. |

### 4.3 State Management

All state lives in the `<App>` component via React hooks. No external state library.

```javascript
const [data, setData]               = useState(buildEmptyData);
// data = { entries, history, meta, health, stats, backups }

const [storageMode, setStorageMode] = useState('local'); // 'api' | 'direct' | 'local'
const [filters, setFilters]         = useState({ statuses, priorities, ... });
const [expandedMap, setExpandedMap] = useState({});   // id → bool, persisted to localStorage
const [saveState, setSaveState]     = useState({ status, lastSaved });
```

Only `expandedMap` is persisted to `localStorage`. All backlog data is always sourced from `backlog.md`.

### 4.4 Rendering Strategy

React 18 reconciliation. The full tree re-renders on data or filter changes; React diffs and patches only changed DOM nodes. Filters are applied in the render path — the canonical `data.entries` is never mutated by filtering.

Responsive breakpoints:
- Desktop: sidebar filter panel + main tree.
- Mobile (< 768 px): filter panel becomes a collapsible drawer.

### 4.5 Dual-Mode Storage

`Storage` is a thin router that picks the active backend at boot time.

**Detection order:**
1. Probe `GET http://localhost:8080/api/health`. If it responds within 500 ms → use `ApiBackend`.
2. Else if `window.showDirectoryPicker` is available → use `DirectBackend`.
3. Else show a message: "Please run `python3 server.py` or open this page in Chrome/Edge."

#### ApiBackend
- `load()` → `GET /api/backlog`
- `save(content)` → `POST /api/backlog`
- `listBackups()` → `GET /api/backups`
- `restoreBackup(name)` → `POST /api/backups/restore`
- `getStats()` → `GET /api/stats`
- `appendStats(event)` → `POST /api/stats`

#### DirectBackend
- On first launch the user is prompted to pick a **directory** via `showDirectoryPicker()`.
- The directory handle is stored in IndexedDB (`pb-storage-v2` → `handles` → `root`).
- On reload the handle is retrieved from IndexedDB; `queryPermission()` checks silently — no user gesture needed if permission is still active. If it has lapsed, a connect button is shown.
- `load()` → `dirHandle.getFileHandle('backlog.md').getFile()` → read text.
- `save(content)` → `dirHandle.getFileHandle('backlog.md', { create: true }).createWritable()` → write → close.
- `listBackups()` → iterate `dirHandle.getDirectoryHandle('backups', { create: true })`.
- `restoreBackup(name)` → copy backup file handle content over master.
- `getStats()` / `appendStats()` → read/write `stats.jsonl` via the same directory handle.
- Backup rotation runs in the frontend (same algorithm as server) after every successful save.

## 5. Backend Architecture

### 5.1 Server (`server.py`)

A single Python file (~420 LoC) extending `http.server.BaseHTTPRequestHandler`. Zero external dependencies — stdlib only.

Responsibilities:
1. Serve `index-style-v2.html` for `GET /`.
2. Handle REST API routes.
3. Perform atomic file writes.
4. Manage backup rotation.
5. Append stats events.
6. Compute SHA-256 integrity markers on write; verify on read for warning purposes only (never block loading).

### 5.2 REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serve `index-style-v2.html` |
| `GET` | `/api/backlog?checksum=<optional>` | Return current markdown content + checksum. If `checksum` matches, return `304 Not Modified`. Checksum mismatch never blocks loading. |
| `POST` | `/api/backlog` | Accept JSON `{ content }`. Write atomically, create backup, verify integrity marker is syntactically valid, return new checksum. |
| `GET` | `/api/backups` | List backups: `[{ name, size, timestamp, valid }]`. |
| `GET` | `/api/backups/<name>` | Download a backup file. |
| `POST` | `/api/backups/restore` | Body `{ name }`. Copy backup over master after checking backup is readable. |
| `POST` | `/api/export` | Body `{ format: "json" }`. Return structured dump. |
| `POST` | `/api/import` | Multipart upload. Validate, then replace master. |
| `POST` | `/api/stats` | Body `{ event, payload }`. Append one line to `stats.jsonl`. |
| `GET` | `/api/stats?from=&to=&aggregate=` | Read stats events and/or roll-ups. |
| `GET` | `/api/health` | `{ status, lastSave, lastBackup, masterSize, backupCount }`. |

### 5.3 Atomic Write Sequence

```
Client POSTs new markdown content
         │
         ▼
Server writes to backlog.md.tmp
         │
         ▼
Server parses tmp file, verifies integrity marker is syntactically valid
         │
         ▼
Server copies tmp → backups/backlog_YYYY-MM-DD_HH-mm-ss.md
         │
         ▼
Server runs backup rotation (prune old files)
         │
         ▼
Server renames tmp → backlog.md
         │
         ▼
Server appends "save_completed" event to stats.jsonl
         │
         ▼
Server returns { ok: true, checksum, saved }
```

### 5.4 Backup Rotation Algorithm

```python
def rotate_backups(backups_dir):
    files = sorted(glob("backlog_*.md"), key=extract_timestamp)
    # Keep everything for 7 days
    for f in files:
        if age(f) <= 7 days:
            continue
        # After 7 days: keep only the newest per calendar day
        day = extract_calendar_day(f)
        if f != newest_file_for_day(day):
            os.remove(f)
    # Hard cap: never delete the single most recent backup
```

### 5.5 External Change Detection

- **API mode**: polls `GET /api/backlog?checksum=<local>` every 5 seconds.
  - `304 Not Modified` → nothing to do.
  - `200 + new content` → file changed externally.
- **Direct mode**: calls `Storage.load()` every 5 seconds and compares checksums.

In both modes:
- If `Store.dirty === false`: auto-reload, show toast notification.
- If `Store.dirty === true`: show conflict modal with options:
  - **Overwrite local** (discard unsaved edits, load disk version).
  - **Force save** (overwrite disk with local version).
  - **Download both** (save local as file, then reload disk version).

## 6. Data Layer Details

### 6.1 Master File (`backlog.md`)

Exactly as specified in [Requirements §3.2](../requirements/requirements.md). The server and client both know how to parse and generate the three sections (`ENTRIES`, `HISTORY`, `INTEGRITY`).

**Checksum algorithm:**
```
sha256( utf8_bytes( entries_section + "\n" + history_section ) )
```
The integrity marker comment is excluded from the hash.

**Checksum policy:**
- On **save**, the writer computes the hash and appends the marker. This proves the file was written completely.
- On **load**, the reader computes the hash and compares it to the stored marker.
  - If they match → green status, no banner.
  - If they mismatch → **yellow warning banner** ("Checksum mismatch — file was edited outside the app"). The file still loads normally. The next save will overwrite the marker with the correct value.
  - If the marker is missing → same yellow warning.

### 6.2 Stats File (`stats.jsonl`)

One JSON object per line, newline-delimited:

```jsonl
{"t":"2025-05-10T14:32:01Z","e":"item_created","d":{"id":"task-1","level":3,"project":"proj-1"}}
{"t":"2025-05-10T14:35:00Z","e":"save_completed","d":{"size":12400,"ms":45}}
```

The server exposes a simple aggregator that reads the last 90 days of lines and computes roll-ups on demand. For large files, a memory-mapped or seek-from-end strategy can be used.

## 7. Safety Considerations

This is a single-user local tool, not a production service. The only real threats are data loss and file corruption.

| Concern | Mitigation |
|---------|------------|
| **Data loss** | Atomic writes (temp file + rename) + automatic backup on every save + rotating backup retention. |
| **File corruption** | Integrity marker proves the file was written completely; parser validates structure before accepting. |
| **Path traversal** | Backup names are generated by the server, never from user input. Restore validates the file exists and is readable. |
| **Network exposure** | Server binds to `0.0.0.0` for convenience (access from phone/tablet on same LAN). No auth — this is intentional for a personal tool. |

## 8. Build & Distribution

The repository contains:

```
personal-backlog/
├── server/
│   └── server.py           # Python REST API server (stdlib only)
├── web/                    # V2 source (JSX + CSS + bundler)
├── webapp/
│   └── index-style-v2.html # Self-contained SPA (built artifact)
├── backlog.md              # master data file (created on first save)
├── backups/                # created automatically
└── stats.jsonl             # created automatically
```

### 8.1 Running the App

**Mode A — API Server (all browsers):**
```bash
python3 server/server.py --port 8080 --dir ~/my-backlog
```
Then open `http://localhost:8080`.

**Mode B — Direct Access (Chrome/Edge, zero server):**
```bash
open webapp/index-style-v2.html
```
The app will prompt you to pick a directory. Create a folder, select it, and the app will create `backlog.md`, `backups/`, and `stats.jsonl` inside it.

**Building the bundle from source:**
```bash
cd web && npm install
node bundle.js index.html ../webapp/index-style-v2.html
```

### 8.2 First-Time Setup

- **API mode**: If `backlog.md` does not exist in the server `--dir`, the server creates a blank template with an empty `ENTRIES` section, an empty `HISTORY` table, and a valid `INTEGRITY` marker.
- **Direct mode**: If the selected directory does not contain `backlog.md`, the frontend creates the same blank template via `DirectBackend`.

## 9. Performance Budget

| Target | Limit | How |
|--------|-------|-----|
| Initial load | < 200 KB transferred | Single HTML, no external assets. |
| Startup time | < 1 s for ≤ 1 MB backlog | Parse markdown in one pass; lazy-load admin charts. |
| Save latency | < 300 ms | Atomic rename is instant; SHA-256 of 1 MB is ~5 ms. |
| Render tree | < 50 ms for 500 items | Reuse DOM nodes where possible; virtual scrolling optional future enhancement. |
| Poll overhead | Negligible | 304 responses are empty body; checksum is cached server-side. |

## 10. Future Extensibility (No-Regret Decisions)

1. **Dark mode** — CSS custom properties (`:root` variables) are used for all colors, so a theme switch is a one-line class toggle.
2. **Multi-user** — The server already validates checksums; adding a simple session token or Basic Auth header would be trivial if needed later.
3. **Firefox/Safari direct access** — If those browsers ever gain write access via File System Access API, `DirectBackend` will work without code changes.
