# Personal Backlog — Requirements

## 1. Purpose

A simplistic, single-user, locally-hosted web UI for tracking personal projects, tasks, and their completion state. All persistent data lives in **one human-readable Markdown file** that contains the full backlog, status history, and audit log. The application loads this file on startup and re-saves it on every change.

## 2. Core Principles

| # | Principle |
|---|-----------|
| 1 | **Markdown as the database** — The `.md` file is the sole source of truth. It must remain readable in any text editor. |
| 2 | **Atomic save with integrity marker** — Every successful write ends with a verifiable marker so the app (and a human) can confirm the file was saved completely. |
| 3 | **Automatic rotating backups** — At least one week of backups must be kept automatically. |
| 4 | **No external runtime dependencies** — The app runs locally in a browser; storage is the filesystem (or a local dev server). |

## 3. Data Model & Hierarchy

### 3.1 Nesting Levels
The backlog supports **up to 4 levels** of nesting:

```
Level 1 — Area / Theme (optional)
Level 2 — Project
Level 3 — Task
Level 4 — Sub-task
```

*One-off tasks* may sit at Level 2 (as a standalone item with no children) or Level 3.

### 3.2 Markdown File Format (Normative)
The master file is divided into **three sections**:

```markdown
# Backlog

<!-- SECTION: ENTRIES -->

## [P1] 🌐 My Project
- [ ] Task A *(due: 2025-06-01, status: open)*
  - [x] Sub-task A.1 *(done: 2025-05-10)*
- [!] Task B *(status: blocked, reason: waiting for API keys)*

## [P2] 📦 Another Project
...

<!-- SECTION: HISTORY -->

| Timestamp | Item ID | Action | Details |
|-----------|---------|--------|---------|
| 2025-05-10T14:32:00Z | task-a-1 | status_changed | open → done |

<!-- SECTION: INTEGRITY -->

<!-- saved: 2025-05-10T14:35:12Z | checksum: sha256:abc123... | entries: 42 | history: 128 -->
```

**Rules:**
- `<!-- SECTION: ENTRIES -->` contains the live backlog tree.
- `<!-- SECTION: HISTORY -->` contains an append-only audit table of every mutation.
- `<!-- SECTION: INTEGRITY -->` contains the save marker:
  - `saved`: ISO-8601 timestamp of the write.
  - `checksum`: SHA-256 over the concatenation of `ENTRIES` + `HISTORY`.
  - `entries`: count of backlog items.
  - `history`: count of history rows.
- The checksum is a **save-success indicator**, not a hard gate. If the marker is missing or the checksum does not match, the app loads the file anyway but shows a non-blocking warning banner (e.g., "File was edited outside the app — checksum mismatch"). The next save will rewrite a correct marker.

## 4. Functional Requirements

### 4.1 Statuses (REQ-F-001)
Each item has a **status** drawn from the following set:

| Status | Glyph | Meaning |
|--------|-------|---------|
| `open` | `[ ]` | Not started yet |
| `in-progress` | `[/]` | Actively being worked on |
| `blocked` | `[!]` | Cannot proceed; requires external action |
| `postponed` | `[>]` | Intentionally deferred |
| `done` | `[x]` | Completed |
| `cancelled` | `[-]` | No longer relevant |

- Changing status appends a row to the **HISTORY** section.
- `blocked` must allow a short free-text `reason` field.

### 4.1a Progress (REQ-F-001a)
- Every item carries an optional **progress** percentage: `0–100`.
- New tasks default to `0%`.
- Setting status to `done` automatically sets progress to `100%`.
- `blocked` and `cancelled` items may retain any progress value (e.g., partially done before being blocked).
- Progress is stored inline in the Markdown metadata as `progress: N`.
- The UI shows a small progress bar next to the task title.

### 4.2 Priorities & Ordering (REQ-F-002)
- Each item carries a **priority** label: `P0` (burning), `P1`, `P2`, or `P3`.
- Within the **same priority**, items are ordered manually via **drag-and-drop**.
- The UI renders items in priority-descending, then manual-order order.
- `P0` items are visually highlighted (e.g., fire emoji 🔥 or a distinct border) to mark "hot / burning" status.

### 4.3 Due Dates (REQ-F-003)
- Optional `due` date per item (ISO-8601 date: `YYYY-MM-DD`).
- Overdue items are visually flagged.

### 4.4 Tags & Labels (REQ-F-004)
- Items may have free-form **tags** (e.g., `#urgent`, `#research`).
- Tags are stored inline in the Markdown item metadata.
- The UI offers **autocomplete** based on the most recently used tags across the backlog.
- Tags are filterable (multi-select) alongside status and priority.

### 4.5 Filtering & Search (REQ-F-005)
The UI must provide filters for:
- Status (multi-select)
- Priority (multi-select)
- Due date range (`overdue`, `today`, `this week`, `this month`, `custom`)
- Full-text search across titles, descriptions, block reasons, and tags
- Scope: `all`, `top-level only`, or `current project`

**Parent Visibility Rule:** When a filter or quicksearch matches a task at any level, all ancestor projects/items up to the root must remain visible in the tree so the user understands the hierarchical context. Conversely, if a project matches a filter, it may be shown collapsed unless the filter also matches its children.

### 4.6 Mutations & Save (REQ-F-006)
- Every create, update, delete, reorder, or status change triggers a **full re-save** of the master Markdown file.
- The save is **atomic**: write to a temp file, verify the integrity marker, then rename over the original.
- On save failure, the UI shows a non-dismissible banner and keeps the in-memory state intact so the user can retry or export.

### 4.7 External File Monitoring (REQ-F-007)
- The app **watches the master Markdown file** for external changes (e.g., edited via another editor, synced via Dropbox/Git).
- If the file changes on disk and passes the integrity check, the app reloads it automatically and notifies the user.
- If an external change conflicts with unsaved local edits, the UI presents a diff/merge choice rather than silently overwriting.

### 4.8 Import & Export (REQ-F-008)
- **Export**: the user may export the current backlog as a Markdown file or as JSON (full structured dump including history).
- **Import**: the user may import a previously exported Markdown or JSON file.
- Import validates schema (for JSON) and warns on checksum mismatch (for Markdown), but never blocks loading a manually edited file.

## 5. Backup & Recovery

### 5.1 Automatic Rotating Backups (REQ-B-001)
- On every successful save, a timestamped copy is written to a `./backups/` directory.
- Naming convention: `backlog_YYYY-MM-DD_HH-mm-ss.md`
- Rotation policy: keep **at least 7 days** of backups. Older backups may be pruned automatically, but the most recent backup from each calendar day must be preserved for 30 days.

### 5.2 Recovery UI (REQ-B-002)
- The **Admin / Maintenance** page (see §6) lists available backups with:
  - Timestamp
  - File size
  - Entry count
  - Integrity check result (valid / corrupt)
- The user may:
  - Preview a backup read-only.
  - Restore a backup (with a confirmation modal).
  - Download any backup as a file.

## 6. Admin & Maintenance Page (REQ-A-001)

A dedicated route/page in the SPA (`/admin` or similar) accessible from a gear icon. It must provide:

| Widget | Content |
|--------|---------|
| **System Health** | Integrity of current file, last save timestamp, last backup timestamp. |
| **Storage Stats** | Master file size, backup directory size, number of backups. |
| **Backup Browser** | List, preview, restore, download backups (§5.2). |
| **Stats Overview** | Key metrics sourced from the stats database (§7): items created/completed this week, average time in `in-progress`, most active project, etc. |
| **Manual Actions** | Force save, force backup, compact history (collapse old `done` items into a summary row). |

## 7. Stats & Metrics Database (REQ-S-001)

### 7.1 Purpose
A separate **append-only** stats store (implementation-agnostic: JSONL file, SQLite, or IndexedDB) that captures usage metrics and enables the admin widgets. It is *not* the source of truth for backlog data; it is purely analytical.

### 7.2 Events to Capture
- `item_created` — id, timestamp, level, project
- `item_status_changed` — id, timestamp, old_status, new_status, duration_in_previous_status
- `item_deleted` — id, timestamp, final_status
- `item_moved` — id, timestamp, old_parent, new_parent
- `item_reordered` — id, timestamp
- `save_completed` — timestamp, file_size, duration_ms
- `backup_created` — timestamp, file_size
- `filter_used` — timestamp, criteria JSON
- `page_view` — timestamp, route

### 7.3 Retention & Privacy
- Retain raw events for 90 days.
- Aggregate older data into daily/weekly roll-ups.
- All data stays local; no telemetry is sent externally.

## 8. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| REQ-NF-001 | The app must work fully offline after initial load. |
| REQ-NF-002 | Startup time (file load + render) must be < 1 s for a file ≤ 1 MB. |
| REQ-NF-003 | The Markdown file must be valid CommonMark and render legibly in any Markdown viewer. |
| REQ-NF-004 | All dates/times are stored in UTC, displayed in the user's local timezone. |
| REQ-NF-005 | The UI must be keyboard-navigable (expand/collapse, toggle status, quick filter shortcuts). |
| REQ-NF-006 | The UI must be responsive and usable on screens down to 375 px width (mobile). |

## 9. Out of Scope / Future Considerations

1. **Recurring tasks** — Not supported; all items are one-time.
2. **Third-party integrations** — Conversion scripts can be written against the Markdown or JSON export format if needed.
3. **Theme / appearance** — Light theme only for the initial release. CSS custom properties are used throughout so that a dark mode or custom theme can be added later without structural changes.

