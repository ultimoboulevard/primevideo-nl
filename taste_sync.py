"""Sync TMDB user ratings into the taste profile (my_taste.json).

Fetches all rated movies/TV from the user's TMDB account and
regenerates the taste vector. Merges with any existing profile
so both TMDB ratings and Excel bootstrap contribute.
"""
from __future__ import annotations

import json
import logging
import time
from collections import Counter
from pathlib import Path

import httpx

from config import (
    TMDB_API_KEY, TMDB_BASE_URL, TMDB_ACCOUNT_ID,
    TMDB_SESSION_ID, SITE_DATA_DIR, LANGUAGE,
)

log = logging.getLogger(__name__)

# Genre → taste signal mapping (same as taste.js client-side)
GENRE_SIGNAL_MAP = {
    'Drama': 'drama', 'Comedy': 'comedy', 'Action': 'action',
    'Thriller': 'thriller', 'Horror': 'horror', 'Romance': 'romance',
    'Science Fiction': 'scifi', 'Sci-Fi & Fantasy': 'scifi',
    'Fantasy': 'fantasy', 'Animation': 'animation',
    'Documentary': 'documentary', 'Crime': 'crime', 'Mystery': 'mystery',
    'Adventure': 'adventure', 'Family': 'family', 'Music': 'music',
    'War': 'war', 'History': 'history', 'Western': 'western',
    'TV Movie': 'drama', 'Action & Adventure': 'action',
    'War & Politics': 'war', 'Kids': 'family',
}


def fetch_all_rated(media_type: str = "movies") -> list[dict]:
    """Fetch all rated movies or TV shows from the user's TMDB account."""
    endpoint = f"{TMDB_BASE_URL}/account/{TMDB_ACCOUNT_ID}/rated/{media_type}"
    client = httpx.Client(timeout=15)
    all_items = []
    page = 1

    while True:
        resp = client.get(endpoint, params={
            "api_key": TMDB_API_KEY,
            "session_id": TMDB_SESSION_ID,
            "language": LANGUAGE,
            "sort_by": "created_at.desc",
            "page": page,
        })
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])
        all_items.extend(results)
        log.info("Fetched page %d/%d of rated %s (%d items)",
                 page, data.get("total_pages", 1), media_type, len(results))
        if page >= data.get("total_pages", 1):
            break
        page += 1
        time.sleep(0.25)

    client.close()
    return all_items


def build_taste_vector(rated_movies: list, rated_tv: list) -> dict:
    """Build a taste vector from TMDB rated items."""
    signal_counts = Counter()
    total = 0

    for item in rated_movies + rated_tv:
        # TMDB genre_ids need to be resolved — but rated items have full genre objects
        # if fetched with details. Trending items have genre_ids.
        genres = item.get("genre_ids", [])
        rating = item.get("rating", 5)  # User's rating (1-10)

        # Weight by user rating: higher rated = stronger signal
        weight = rating / 10.0

        # Resolve genre_ids via a separate lookup if needed
        # For rated items, we'll need to fetch genre names
        total += 1

    return signal_counts, total


def sync_taste() -> dict:
    """Main sync: fetch TMDB ratings, build taste vector, save to my_taste.json."""
    log.info("Syncing taste profile from TMDB account %d...", TMDB_ACCOUNT_ID)

    # Fetch all rated content
    rated_movies = fetch_all_rated("movies")
    rated_tv = fetch_all_rated("tv")
    total_tmdb = len(rated_movies) + len(rated_tv)
    log.info("TMDB ratings: %d movies + %d TV = %d total",
             len(rated_movies), len(rated_tv), total_tmdb)

    # Fetch genre maps for ID → name resolution
    client = httpx.Client(timeout=15)
    genre_map = {}
    for mt in ("movie", "tv"):
        resp = client.get(f"{TMDB_BASE_URL}/genre/{mt}/list", params={
            "api_key": TMDB_API_KEY, "language": LANGUAGE
        })
        resp.raise_for_status()
        for g in resp.json().get("genres", []):
            genre_map[g["id"]] = g["name"]
    client.close()

    # Build signal weights from TMDB ratings
    signal_weights = Counter()
    for item in rated_movies + rated_tv:
        user_rating = item.get("rating", 5)
        weight = user_rating / 10.0
        for gid in item.get("genre_ids", []):
            genre_name = genre_map.get(gid, "")
            signal = GENRE_SIGNAL_MAP.get(genre_name)
            if signal:
                signal_weights[signal] += weight

    # Load existing profile (Excel bootstrap)
    taste_path = SITE_DATA_DIR / "my_taste.json"
    existing = {}
    if taste_path.exists():
        with open(taste_path) as f:
            existing = json.load(f)
        log.info("Existing profile: %d ratings, %d signals",
                 existing.get("totalRatings", 0),
                 len(existing.get("signals", {})))

    # Merge: existing signals + TMDB signals
    merged_signals = dict(existing.get("signals", {}))
    if signal_weights:
        # Normalize TMDB signals to 0-1 range
        max_w = max(signal_weights.values()) if signal_weights else 1
        for signal, weight in signal_weights.items():
            tmdb_normalized = weight / max_w
            # Weighted merge: existing has more history, TMDB adds fresh signal
            existing_val = merged_signals.get(signal, 0)
            existing_count = existing.get("totalRatings", 0)
            if existing_count > 0:
                # Blend: 70% existing + 30% TMDB (since TMDB ratings are fresh intent)
                merged_signals[signal] = existing_val * 0.7 + tmdb_normalized * 0.3
            else:
                merged_signals[signal] = tmdb_normalized

    # Re-normalize so max signal = 1.0
    if merged_signals:
        max_sig = max(merged_signals.values())
        if max_sig > 0:
            merged_signals = {k: round(v / max_sig, 4) for k, v in merged_signals.items()}

    # Build output
    taste = {
        "signals": merged_signals,
        "totalRatings": existing.get("totalRatings", 0) + total_tmdb,
        "tmdbRatings": total_tmdb,
        "lastSync": __import__("datetime").datetime.utcnow().isoformat(),
        "ratedTitles": [
            {"id": m["id"], "rating": m.get("rating", 0),
             "title": m.get("title", m.get("name", ""))}
            for m in rated_movies + rated_tv
        ],
    }

    # Save
    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(taste_path, "w", encoding="utf-8") as f:
        json.dump(taste, f, ensure_ascii=False, indent=2)

    log.info("Taste profile updated: %d total ratings, %d TMDB, %d signals → %s",
             taste["totalRatings"], total_tmdb, len(merged_signals), taste_path)
    return taste


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    result = sync_taste()
    print(f"Synced {result['tmdbRatings']} TMDB ratings, "
          f"{result['totalRatings']} total, "
          f"{len(result['signals'])} taste signals")
