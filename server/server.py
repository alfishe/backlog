#!/usr/bin/env python3
"""Personal Backlog - lightweight file server + REST API.

Zero dependencies (Python 3 stdlib only).
Usage: python3 server.py --port 8080 --dir ./data
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse


class Config:
    def __init__(self, directory: Path, port: int, web_dir: Path | None = None):
        self.dir = directory.resolve()
        self.port = port
        self.master = self.dir / "backlog.md"
        self.backups_dir = self.dir / "backups"
        self.stats_file = self.dir / "stats.jsonl"
        self.web_dir = web_dir.resolve() if web_dir else Path(__file__).parent.parent / "webapp"

    def ensure_dirs(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        self.backups_dir.mkdir(exist_ok=True)


CONFIG: Config = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Markdown integrity helpers
# ---------------------------------------------------------------------------

def compute_checksum(entries_text: str, history_text: str) -> str:
    payload = entries_text + "\n" + history_text
    h = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"sha256:{h}"


def parse_markdown_sections(text: str):
    """Split markdown into entries, history, and integrity sections.
    Returns (entries_text, history_text, integrity_meta dict or None).
    """
    # Find section markers
    entries_start = text.find("<!-- SECTION: ENTRIES -->")
    history_start = text.find("<!-- SECTION: HISTORY -->")
    integrity_start = text.find("<!-- SECTION: INTEGRITY -->")

    if entries_start == -1:
        # No sections found — treat entire text as entries
        return text, "", None

    entries_text = text[entries_start:history_start if history_start != -1 else len(text)]
    history_text = ""
    integrity_meta = None

    if history_start != -1:
        end = integrity_start if integrity_start != -1 else len(text)
        history_text = text[history_start:end]

    if integrity_start != -1:
        integrity_block = text[integrity_start:]
        # Parse comment like <!-- saved: ... | checksum: ... | entries: ... | history: ... -->
        m = re.search(r"saved:\s*([^|]+?)\s*\|\s*checksum:\s*([^|]+?)\s*\|\s*entries:\s*(\d+)\s*\|\s*history:\s*(\d+)", integrity_block)
        if m:
            integrity_meta = {
                "saved": m.group(1).strip(),
                "checksum": m.group(2).strip(),
                "entries": int(m.group(3)),
                "history": int(m.group(4)),
            }

    return entries_text, history_text, integrity_meta


def make_integrity_marker(entries_text: str, history_text: str) -> str:
    checksum = compute_checksum(entries_text, history_text)
    entry_count = len(re.findall(r"^[-*] \[", entries_text, re.MULTILINE))
    history_count = len([l for l in history_text.splitlines() if l.startswith("|") and "Timestamp" not in l])
    saved = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f"<!-- saved: {saved} | checksum: {checksum} | entries: {entry_count} | history: {history_count} -->"


def build_markdown(entries_text: str, history_text: str) -> str:
    marker = make_integrity_marker(entries_text, history_text)
    return f"# Backlog\n\n<!-- SECTION: ENTRIES -->\n\n{entries_text}\n\n<!-- SECTION: HISTORY -->\n\n{history_text}\n\n<!-- SECTION: INTEGRITY -->\n\n{marker}\n"


# ---------------------------------------------------------------------------
# File operations
# ---------------------------------------------------------------------------

def read_master() -> dict:
    if not CONFIG.master.exists():
        return {"content": build_markdown("", "| Timestamp | Item ID | Action | Details |\n|-----------|---------|--------|---------|"), "checksum": "", "size": 0}
    text = CONFIG.master.read_text(encoding="utf-8")
    entries, history, meta = parse_markdown_sections(text)
    checksum = meta["checksum"] if meta else ""
    return {"content": text, "checksum": checksum, "size": len(text.encode("utf-8"))}


def write_master(content: str) -> dict:
    """Atomic write with backup."""
    tmp = CONFIG.master.with_suffix(".md.tmp")
    # Write temp
    tmp.write_text(content, encoding="utf-8")
    # Verify it parses
    parse_markdown_sections(content)
    # Create backup (millis to avoid collisions)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    millis = datetime.now(timezone.utc).strftime("%f")[:3]
    backup_name = f"backlog_{timestamp}-{millis}.md"
    backup_path = CONFIG.backups_dir / backup_name
    shutil.copy2(tmp, backup_path)
    rotate_backups()
    # Atomic rename
    tmp.replace(CONFIG.master)
    # Stats
    append_stats({"t": datetime.now(timezone.utc).isoformat(), "e": "save_completed", "d": {"size": len(content.encode("utf-8"))}})
    _, _, meta = parse_markdown_sections(content)
    return {"ok": True, "checksum": meta["checksum"] if meta else "", "saved": meta["saved"] if meta else ""}


def rotate_backups():
    files = sorted(CONFIG.backups_dir.glob("backlog_*.md"), key=lambda p: p.stat().st_mtime)
    if not files:
        return
    now = datetime.now(timezone.utc)
    for f in files[:-1]:  # never delete the most recent
        age_days = (now.timestamp() - f.stat().st_mtime) / 86400
        if age_days <= 7:
            continue
        day = f.name.split("_")[1]  # YYYY-MM-DD
        same_day = [x for x in files if x.name.startswith(f"backlog_{day}")]
        if f != max(same_day, key=lambda p: p.stat().st_mtime):
            f.unlink()


def list_backups() -> list:
    result = []
    for f in sorted(CONFIG.backups_dir.glob("backlog_*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
        text = f.read_text(encoding="utf-8")
        _, _, meta = parse_markdown_sections(text)
        result.append({
            "name": f.name,
            "size": f.stat().st_size,
            "timestamp": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
            "valid": meta is not None,
        })
    return result


def restore_backup(name: str) -> dict:
    src = CONFIG.backups_dir / name
    if not src.exists():
        return {"ok": False, "error": "Backup not found"}
    text = src.read_text(encoding="utf-8")
    parse_markdown_sections(text)  # validate readable
    shutil.copy2(src, CONFIG.master)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def append_stats(event: dict):
    with open(CONFIG.stats_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def read_stats(from_iso: str = None, to_iso: str = None) -> list:
    if not CONFIG.stats_file.exists():
        return []
    events = []
    with open(CONFIG.stats_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
                t = ev.get("t", "")
                if from_iso and t < from_iso:
                    continue
                if to_iso and t > to_iso:
                    continue
                events.append(ev)
            except json.JSONDecodeError:
                continue
    return events


# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Suppress default logging
        pass

    def _json_response(self, data: dict, status: int = 200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _text_response(self, text: str, status: int = 200, content_type: str = "text/plain"):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _file_response(self, path: Path, content_type: str = "application/octet-stream"):
        if not path.exists():
            self._json_response({"error": "Not found"}, 404)
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        # Serve static files from web_dir for / and any non-API path
        if not path.startswith("/api/"):
            # Map / → index.html, otherwise strip leading /
            rel = "index-style-v2.html" if path == "/" else path.lstrip("/")
            target = (CONFIG.web_dir / rel).resolve()
            # Safety: stay inside web_dir
            try:
                target.relative_to(CONFIG.web_dir)
            except ValueError:
                self._json_response({"error": "Forbidden"}, 403)
                return
            if target.exists() and target.is_file():
                ext = target.suffix.lower()
                mime = {
                    ".html": "text/html", ".css": "text/css",
                    ".js": "application/javascript", ".jsx": "application/javascript",
                    ".json": "application/json", ".md": "text/markdown",
                    ".png": "image/png", ".svg": "image/svg+xml",
                }.get(ext, "application/octet-stream")
                self._file_response(target, mime)
            else:
                self._json_response({"error": "Not found"}, 404)
            return

        if path == "/api/health":
            info = read_master()
            backups = list_backups()
            self._json_response({
                "status": "ok",
                "lastSave": info.get("meta", {}).get("saved", "") if isinstance(info, dict) else "",
                "lastBackup": backups[0]["timestamp"] if backups else "",
                "masterSize": CONFIG.master.stat().st_size if CONFIG.master.exists() else 0,
                "backupCount": len(backups),
                "masterPath": str(CONFIG.master),
                "backupsPath": str(CONFIG.backups_dir),
            })
            return

        if path == "/api/backlog":
            info = read_master()
            client_checksum = qs.get("checksum", [None])[0]
            if client_checksum and client_checksum == info["checksum"]:
                self.send_response(304)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                return
            self._json_response({"content": info["content"], "checksum": info["checksum"]})
            return

        if path == "/api/backups":
            self._json_response({"backups": list_backups()})
            return

        if path.startswith("/api/backups/"):
            name = path[len("/api/backups/"):]
            backup_path = CONFIG.backups_dir / name
            self._file_response(backup_path, "text/markdown")
            return

        if path == "/api/stats":
            events = read_stats(qs.get("from", [None])[0], qs.get("to", [None])[0])
            self._json_response({"events": events})
            return

        self._json_response({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/backlog":
            body = self._read_json_body()
            content = body.get("content", "")
            result = write_master(content)
            self._json_response(result)
            return

        if path == "/api/backups/restore":
            body = self._read_json_body()
            result = restore_backup(body.get("name", ""))
            self._json_response(result)
            return

        if path == "/api/export":
            body = self._read_json_body()
            fmt = body.get("format", "json")
            info = read_master()
            if fmt == "json":
                entries, history, meta = parse_markdown_sections(info["content"])
                self._json_response({
                    "format": "json",
                    "exported_at": datetime.now(timezone.utc).isoformat(),
                    "entries_raw": entries,
                    "history_raw": history,
                    "integrity": meta,
                })
            else:
                self._text_response(info["content"], content_type="text/markdown")
            return

        if path == "/api/import":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length).decode("utf-8")
            try:
                data = json.loads(raw)
                content = data.get("content", "")
            except json.JSONDecodeError:
                content = raw  # assume markdown
            parse_markdown_sections(content)  # validate readable
            result = write_master(content)
            self._json_response(result)
            return

        if path == "/api/stats":
            body = self._read_json_body()
            append_stats(body)
            self._json_response({"ok": True})
            return

        self._json_response({"error": "Not found"}, 404)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Personal Backlog Server")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on")
    parser.add_argument("--dir", type=str, default=str(Path(__file__).parent),
                        help="Directory for backlog.md, backups/, stats.jsonl (default: same dir as server.py)")
    parser.add_argument("--web-dir", type=str, default=None, help="Directory to serve static files from (default: webapp/)")
    args = parser.parse_args()

    global CONFIG
    web_dir = Path(args.web_dir) if args.web_dir else None
    CONFIG = Config(Path(args.dir), args.port, web_dir)
    CONFIG.ensure_dirs()

    if not CONFIG.master.exists():
        blank = build_markdown("", "| Timestamp | Item ID | Action | Details |\n|-----------|---------|--------|---------|")
        CONFIG.master.write_text(blank, encoding="utf-8")
        print(f"[init] Created blank {CONFIG.master}")

    server = HTTPServer(("0.0.0.0", args.port), Handler)
    print(f"[server] Listening on http://0.0.0.0:{args.port}")
    print(f"[server] Data dir: {CONFIG.dir}")
    print(f"[server] Web dir:  {CONFIG.web_dir}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[server] Shutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
