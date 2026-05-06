"""Export Prime Video NL catalog to JSON for the static site."""
from __future__ import annotations

import json
import logging
from datetime import datetime

from config import SITE_DATA_DIR, TMDB_IMAGE_BASE
from db import init_db, get_all_titles, get_trending, get_new_this_week, get_genres, get_stats

log = logging.getLogger(__name__)


def export_catalog_json(days_new: int = 7) -> str:
    """Export the full catalog to a JSON file for the static site."""
    conn = init_db()

    all_titles = get_all_titles(conn)
    trending = get_trending(conn)
    new_titles = get_new_this_week(conn, days_new)
    genres = get_genres(conn)
    stats = get_stats(conn)

    trending_ids = {t["tmdb_id"] for t in trending}
    new_ids = {t["tmdb_id"] for t in new_titles}

    # Build compact catalog entries
    catalog = []
    for t in all_titles:
        entry = {
            "id": t["tmdb_id"],
            "type": t["media_type"],
            "title": t["title"],
            "overview": t.get("overview", ""),
            "genres": t.get("genres", []),
            "date": t.get("release_date", ""),
            "rating": round(t.get("vote_average", 0), 1),
            "votes": t.get("vote_count", 0),
            "popularity": round(t.get("popularity", 0), 1),
            "poster": f"{TMDB_IMAGE_BASE}/w500{t['poster_path']}" if t.get("poster_path") else None,
            "backdrop": f"{TMDB_IMAGE_BASE}/w780{t['backdrop_path']}" if t.get("backdrop_path") else None,
            "runtime": t.get("runtime"),
            "seasons": t.get("seasons"),
            "trailer": f"https://www.youtube.com/watch?v={t['trailer_key']}" if t.get("trailer_key") else None,
            "trailer_key": t.get("trailer_key"),
            "cast": t.get("cast_names", []),
            "director": t.get("director"),
            "trending": t["tmdb_id"] in trending_ids,
            "new": t["tmdb_id"] in new_ids,
            "first_seen": t.get("first_seen", ""),
        }
        catalog.append(entry)

    payload = {
        "generated_at": datetime.utcnow().isoformat(),
        "stats": stats,
        "genres": genres,
        "catalog": catalog,
    }

    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = SITE_DATA_DIR / "catalog.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    log.info("Exported %d titles to %s (%.1f KB)",
             len(catalog), out_path, out_path.stat().st_size / 1024)
    conn.close()
    return str(out_path)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    path = export_catalog_json()
    print(f"Exported to {path}")
