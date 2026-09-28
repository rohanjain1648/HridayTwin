"""
Persistent store for real-time samples (Bluetooth strap, webcam rPPG, demo stream).

Every sample is kept, so live sources build real history. The twin only overlays the *active*
session (samples newer than the last "stop", within the last few minutes) onto its current state.
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timedelta, timezone

from .config import DATA_DIR

DB_PATH = DATA_DIR / "live.db"
ACTIVE_WINDOW = timedelta(minutes=10)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class LiveStore:
    def __init__(self, path=DB_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript("""
            CREATE TABLE IF NOT EXISTS live_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id TEXT NOT NULL,
                received_at TEXT NOT NULL,
                source TEXT NOT NULL,
                hr REAL, hrv REAL, quality REAL
            );
            CREATE INDEX IF NOT EXISTS ix_live_pid_time ON live_samples(patient_id, received_at);
            CREATE TABLE IF NOT EXISTS live_state (
                patient_id TEXT PRIMARY KEY,
                cleared_at TEXT NOT NULL
            );
        """)
        self._db.commit()

    def add(self, patient_id: str, source: str, hr: float | None, hrv: float | None, quality: float | None = None) -> dict:
        ts = _now().isoformat(timespec="seconds")
        with self._lock:
            self._db.execute("INSERT INTO live_samples (patient_id, received_at, source, hr, hrv, quality) VALUES (?,?,?,?,?,?)",
                             (patient_id, ts, source, hr, hrv, quality))
            self._db.commit()
        return {"received_at": ts}

    def active(self, patient_id: str) -> list[dict]:
        """Samples of the current live session (after the last stop, within the active window)."""
        since = (_now() - ACTIVE_WINDOW).isoformat(timespec="seconds")
        with self._lock:
            row = self._db.execute("SELECT cleared_at FROM live_state WHERE patient_id=?", (patient_id,)).fetchone()
            if row and row["cleared_at"] > since:
                since = row["cleared_at"]
            rows = self._db.execute("SELECT * FROM live_samples WHERE patient_id=? AND received_at>? ORDER BY received_at",
                                    (patient_id, since)).fetchall()
        return [dict(r) for r in rows]

    def stop(self, patient_id: str) -> None:
        with self._lock:
            self._db.execute("INSERT INTO live_state (patient_id, cleared_at) VALUES (?,?) "
                             "ON CONFLICT(patient_id) DO UPDATE SET cleared_at=excluded.cleared_at",
                             (patient_id, _now().isoformat(timespec="seconds")))
            self._db.commit()

    def history(self, patient_id: str, limit: int = 500) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT received_at, source, hr, hrv, quality FROM live_samples WHERE patient_id=? "
                                    "ORDER BY received_at DESC LIMIT ?", (patient_id, limit)).fetchall()
        return [dict(r) for r in reversed(rows)]

    def summary(self, patient_id: str) -> dict:
        with self._lock:
            r = self._db.execute("SELECT COUNT(*) n, MIN(received_at) first, MAX(received_at) last, "
                                 "GROUP_CONCAT(DISTINCT source) sources FROM live_samples WHERE patient_id=?",
                                 (patient_id,)).fetchone()
        return {"samples": r["n"], "first": r["first"], "last": r["last"],
                "sources": r["sources"].split(",") if r["sources"] else []}

    def any_active(self) -> bool:
        since = (_now() - ACTIVE_WINDOW).isoformat(timespec="seconds")
        with self._lock:
            pids = [r[0] for r in self._db.execute(
                "SELECT DISTINCT patient_id FROM live_samples WHERE received_at>?", (since,)).fetchall()]
        return any(self.active(p) for p in pids)
