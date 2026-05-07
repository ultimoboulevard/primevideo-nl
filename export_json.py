"""Export NirvanAI catalog to JSON for the static site."""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime

import httpx

from config import SITE_DATA_DIR, TMDB_IMAGE_BASE, TMDB_API_KEY, TMDB_BASE_URL, WATCH_REGION, LANGUAGE
from db import init_db, get_all_titles, get_trending, get_new_this_week, get_genres, get_stats

log = logging.getLogger(__name__)

# ── Provider name→badge mapping for spotlight ─────────────────
PROVIDER_BADGES = {
    'Netflix': 'N', 'Amazon Prime Video': '▶', 'Apple TV': '',
    'Disney Plus': 'D+', 'MUBI': 'Ⓜ', 'SkyShowtime': 'Sky',
    'Viaplay': 'Via', 'Videoland': 'VL', 'HBO Max': 'HBO',
    'Pathé Thuis': 'PT', 'NPO Start': 'NPO', 'Crunchyroll': 'CR',
}


def _compute_interest_score(title: dict) -> float:
    """Phase 0 — Algorithmic quality score (0-100) without personalization.

    Combines:
      - Vote quality: rating weighted by vote count confidence (40%)
      - Hidden gem detection: high rating + low mainstream popularity (30%)
      - Recency: newer content gets a slight boost (20%)
      - Metadata completeness: has director, cast, trailer (10%)
    """
    import math

    rating = title.get("vote_average", 0) or 0
    votes = title.get("vote_count", 0) or 0
    popularity = title.get("popularity", 0) or 0
    release = title.get("release_date", "") or ""

    # ── Vote quality (0-40) ────────────────────────────────
    # Bayesian-style: weight rating by log of vote count
    # A 7.5 with 5000 votes beats a 9.0 with 10 votes
    vote_confidence = min(1.0, math.log10(max(votes, 1)) / 4)  # ~1.0 at 10k votes
    vote_score = (rating / 10) * vote_confidence * 40

    # ── Hidden gem detection (0-30) ────────────────────────
    # High rating (>7) + low popularity (<50) = hidden gem
    if rating >= 7.0 and popularity < 50:
        gem_score = 30 * (rating / 10) * (1 - min(popularity, 50) / 50)
    elif rating >= 7.5 and popularity < 150:
        gem_score = 20 * (rating / 10) * (1 - min(popularity, 150) / 150)
    else:
        gem_score = 0

    # ── Recency (0-20) ────────────────────────────────────
    recency_score = 0
    if release:
        try:
            year = int(release[:4])
            current_year = datetime.utcnow().year
            age = max(0, current_year - year)
            # Logarithmic decay: recent films get more, but classics aren't penalized hard
            recency_score = max(0, 20 - age * 0.8)
        except (ValueError, IndexError):
            pass

    # ── Metadata completeness (0-10) ───────────────────────
    meta_score = 0
    if title.get("director"):
        meta_score += 3
    if title.get("cast_names"):
        meta_score += 3
    if title.get("trailer_key"):
        meta_score += 2
    if title.get("backdrop_path"):
        meta_score += 2

    total = vote_score + gem_score + recency_score + meta_score
    return round(min(100, max(0, total)), 1)

def export_catalog_json(days_new: int = 7) -> str:
    """Export the full catalog to a JSON file for the static site."""
    conn = init_db()

    all_titles = get_all_titles(conn)
    trending = get_trending(conn)
    new_titles = get_new_this_week(conn, days_new)
    genres = get_genres(conn)
    stats = get_stats(conn)

    # Trending: top 10 by popularity for each type (movies + TV separately)
    # This ensures "Movies + Trending" always has results
    movies_sorted = sorted(
        [t for t in all_titles if t['media_type'] == 'movie'],
        key=lambda x: x.get('popularity', 0), reverse=True
    )
    tv_sorted = sorted(
        [t for t in all_titles if t['media_type'] == 'tv'],
        key=lambda x: x.get('popularity', 0), reverse=True
    )
    trending_ids = (
        {t['tmdb_id'] for t in movies_sorted[:10]} |
        {t['tmdb_id'] for t in tv_sorted[:10]}
    )
    new_ids = {t["tmdb_id"] for t in new_titles}

    # Build compact catalog entries
    catalog = []
    for t in all_titles:
        entry = {
            "id": t["tmdb_id"],
            "type": t["media_type"],
            "providers": t.get("providers", ["prime"]),
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
            "interest_score": _compute_interest_score(t),
        }
        catalog.append(entry)

    # ── Spotlight: trending this week (channel-agnostic) ──────
    spotlight = _fetch_spotlight()
    log.info("Spotlight: %d trending titles with NL availability", len(spotlight))

    payload = {
        "generated_at": datetime.utcnow().isoformat(),
        "stats": stats,
        "genres": genres,
        "catalog": catalog,
        "spotlight": spotlight,
    }

    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = SITE_DATA_DIR / "catalog.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    log.info("Exported %d titles to %s (%.1f KB)",
             len(catalog), out_path, out_path.stat().st_size / 1024)
    conn.close()
    return str(out_path)


def _fetch_spotlight(max_items: int = 30) -> list[dict]:
    """Fetch trending titles this week with NL watch provider availability.

    This is channel-agnostic — shows what's hot regardless of platform.
    """
    client = httpx.Client(timeout=15)
    params = {"api_key": TMDB_API_KEY, "language": LANGUAGE}
    spotlight = []
    seen_ids = set()

    # Resolve genre_ids → genre names so TasteEngine can rank
    genre_map = {}
    for mt in ("movie", "tv"):
        try:
            gr = client.get(f"{TMDB_BASE_URL}/genre/{mt}/list", params=params)
            gr.raise_for_status()
            for g in gr.json().get("genres", []):
                genre_map[g["id"]] = g["name"]
        except httpx.HTTPError:
            pass

    for media_type in ("movie", "tv"):
        try:
            resp = client.get(
                f"{TMDB_BASE_URL}/trending/{media_type}/week", params=params
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])
        except httpx.HTTPError as e:
            log.warning("Spotlight fetch failed for %s: %s", media_type, e)
            continue

        for item in results:
            tmdb_id = item["id"]
            if tmdb_id in seen_ids:
                continue
            seen_ids.add(tmdb_id)

            # Fetch NL watch providers
            available_on = []
            try:
                wp_resp = client.get(
                    f"{TMDB_BASE_URL}/{media_type}/{tmdb_id}/watch/providers",
                    params={"api_key": TMDB_API_KEY},
                )
                wp_resp.raise_for_status()
                nl_data = wp_resp.json().get("results", {}).get("NL", {})
                for prov in nl_data.get("flatrate", []):
                    name = prov.get("provider_name", "")
                    available_on.append({
                        "name": name,
                        "badge": PROVIDER_BADGES.get(name, ""),
                        "logo": f"{TMDB_IMAGE_BASE}/w45{prov['logo_path']}" if prov.get("logo_path") else None,
                    })
            except httpx.HTTPError:
                pass
            time.sleep(0.1)

            title_key = "title" if media_type == "movie" else "name"
            date_key = "release_date" if media_type == "movie" else "first_air_date"

            spotlight.append({
                "id": tmdb_id,
                "type": media_type,
                "title": item.get(title_key, ""),
                "overview": (item.get("overview", "") or "")[:200],
                "genres": [genre_map.get(gid, "") for gid in item.get("genre_ids", []) if gid in genre_map],
                "rating": round(item.get("vote_average", 0), 1),
                "votes": item.get("vote_count", 0),
                "popularity": round(item.get("popularity", 0), 1),
                "date": item.get(date_key, ""),
                "poster": f"{TMDB_IMAGE_BASE}/w500{item['poster_path']}" if item.get("poster_path") else None,
                "backdrop": f"{TMDB_IMAGE_BASE}/w780{item['backdrop_path']}" if item.get("backdrop_path") else None,
                "available_on": available_on,
            })

    client.close()
    # Sort by rating descending, cap at max_items
    spotlight.sort(key=lambda x: x.get("rating", 0), reverse=True)
    return spotlight[:max_items]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    path = export_catalog_json()
    print(f"Exported to {path}")
