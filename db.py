"""SQLite database layer for Prime Video NL catalog."""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from config import DB_PATH, DATA_DIR

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS titles (
    tmdb_id       INTEGER PRIMARY KEY,
    media_type    TEXT NOT NULL,
    title         TEXT,
    overview      TEXT,
    genres        TEXT,
    release_date  TEXT,
    vote_average  REAL DEFAULT 0,
    vote_count    INTEGER DEFAULT 0,
    popularity    REAL DEFAULT 0,
    poster_path   TEXT,
    backdrop_path TEXT,
    runtime       INTEGER,
    seasons       INTEGER,
    trailer_key   TEXT,
    cast_names    TEXT,
    director      TEXT,
    is_trending   INTEGER DEFAULT 0,
    first_seen    TEXT,
    last_seen     TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_titles_release ON titles(release_date DESC);
CREATE INDEX IF NOT EXISTS idx_titles_type ON titles(media_type);
CREATE INDEX IF NOT EXISTS idx_titles_trending ON titles(is_trending);
CREATE INDEX IF NOT EXISTS idx_titles_first_seen ON titles(first_seen DESC);
"""


def init_db() -> sqlite3.Connection:
    """Initialize database and return connection."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def upsert_title(conn: sqlite3.Connection, data: dict) -> bool:
    """Insert or update a title. Returns True if it was a new insertion."""
    now = datetime.utcnow().isoformat()
    existing = conn.execute(
        "SELECT tmdb_id, first_seen FROM titles WHERE tmdb_id = ?",
        (data["tmdb_id"],)
    ).fetchone()

    if existing:
        conn.execute("""
            UPDATE titles SET
                title = ?, overview = ?, genres = ?, release_date = ?,
                vote_average = ?, vote_count = ?, popularity = ?,
                poster_path = ?, backdrop_path = ?, runtime = ?,
                seasons = ?, trailer_key = ?, cast_names = ?,
                director = ?, is_trending = ?, last_seen = ?,
                updated_at = ?
            WHERE tmdb_id = ?
        """, (
            data.get("title"), data.get("overview"),
            json.dumps(data.get("genres", [])),
            data.get("release_date"),
            data.get("vote_average", 0), data.get("vote_count", 0),
            data.get("popularity", 0),
            data.get("poster_path"), data.get("backdrop_path"),
            data.get("runtime"), data.get("seasons"),
            data.get("trailer_key"),
            json.dumps(data.get("cast_names", [])),
            data.get("director"),
            data.get("is_trending", 0),
            now, now, data["tmdb_id"]
        ))
        return False
    else:
        conn.execute("""
            INSERT INTO titles (
                tmdb_id, media_type, title, overview, genres,
                release_date, vote_average, vote_count, popularity,
                poster_path, backdrop_path, runtime, seasons,
                trailer_key, cast_names, director, is_trending,
                first_seen, last_seen
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data["tmdb_id"], data["media_type"],
            data.get("title"), data.get("overview"),
            json.dumps(data.get("genres", [])),
            data.get("release_date"),
            data.get("vote_average", 0), data.get("vote_count", 0),
            data.get("popularity", 0),
            data.get("poster_path"), data.get("backdrop_path"),
            data.get("runtime"), data.get("seasons"),
            data.get("trailer_key"),
            json.dumps(data.get("cast_names", [])),
            data.get("director"),
            data.get("is_trending", 0),
            now, now
        ))
        return True


def get_new_this_week(conn: sqlite3.Connection, days: int = 7) -> list[dict]:
    """Titles first seen in the last N days."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    rows = conn.execute("""
        SELECT * FROM titles
        WHERE first_seen >= ?
        ORDER BY media_type, popularity DESC
    """, (cutoff,)).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_trending(conn: sqlite3.Connection) -> list[dict]:
    """Currently trending titles on Prime NL."""
    rows = conn.execute("""
        SELECT * FROM titles
        WHERE is_trending = 1
        ORDER BY popularity DESC
    """).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_all_titles(conn: sqlite3.Connection) -> list[dict]:
    """All titles in the catalog."""
    rows = conn.execute("""
        SELECT * FROM titles
        ORDER BY popularity DESC
    """).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_genres(conn: sqlite3.Connection) -> list[str]:
    """All unique genres in the catalog."""
    rows = conn.execute("SELECT genres FROM titles").fetchall()
    all_genres = set()
    for r in rows:
        try:
            all_genres.update(json.loads(r["genres"]))
        except (json.JSONDecodeError, TypeError):
            pass
    return sorted(all_genres)


def get_stats(conn: sqlite3.Connection) -> dict:
    """Catalog statistics."""
    total = conn.execute("SELECT COUNT(*) FROM titles").fetchone()[0]
    movies = conn.execute("SELECT COUNT(*) FROM titles WHERE media_type='movie'").fetchone()[0]
    tv = conn.execute("SELECT COUNT(*) FROM titles WHERE media_type='tv'").fetchone()[0]
    trending = conn.execute("SELECT COUNT(*) FROM titles WHERE is_trending=1").fetchone()[0]
    new_7d = len(get_new_this_week(conn, 7))
    return {
        "total": total, "movies": movies, "tv_shows": tv,
        "trending": trending, "new_this_week": new_7d
    }


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a Row to a plain dict with parsed JSON fields."""
    d = dict(row)
    for field in ("genres", "cast_names"):
        if d.get(field):
            try:
                d[field] = json.loads(d[field])
            except (json.JSONDecodeError, TypeError):
                d[field] = []
    return d
