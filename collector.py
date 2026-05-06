"""TMDB API collector for Prime Video NL catalog."""
from __future__ import annotations

import logging
import time

import httpx

from config import (
    TMDB_API_KEY, TMDB_BASE_URL, PRIME_PROVIDER_ID,
    WATCH_REGION, LANGUAGE,
)
from db import init_db, upsert_title

log = logging.getLogger(__name__)


class TMDBCollector:
    """Fetches the full Prime Video NL catalog from TMDB."""

    def __init__(self, api_key: str = TMDB_API_KEY):
        self.api_key = api_key
        self.client = httpx.Client(timeout=30)
        self._genre_map: dict[int, str] = {}

    # ── Public ─────────────────────────────────────────────────

    def collect_all(self) -> dict:
        """Full collection pipeline. Returns stats."""
        conn = init_db()
        self._load_genre_maps()

        # Fetch trending IDs first (cross-reference later)
        trending_ids = self._fetch_trending_ids()
        log.info("Trending IDs: %d", len(trending_ids))

        # Discover all movies on Prime NL
        new_movies = 0
        movies = self._discover("movie")
        log.info("Discovered %d movies on Prime NL", len(movies))
        for i, m in enumerate(movies):
            detail = self._fetch_detail("movie", m["id"])
            if detail:
                detail["is_trending"] = int(m["id"] in trending_ids)
                is_new = upsert_title(conn, detail)
                if is_new:
                    new_movies += 1
            if (i + 1) % 50 == 0:
                conn.commit()
                log.info("  Movies: %d/%d processed", i + 1, len(movies))

        # Discover all TV shows on Prime NL
        new_shows = 0
        shows = self._discover("tv")
        log.info("Discovered %d TV shows on Prime NL", len(shows))
        for i, s in enumerate(shows):
            detail = self._fetch_detail("tv", s["id"])
            if detail:
                detail["is_trending"] = int(s["id"] in trending_ids)
                is_new = upsert_title(conn, detail)
                if is_new:
                    new_shows += 1
            if (i + 1) % 50 == 0:
                conn.commit()
                log.info("  TV shows: %d/%d processed", i + 1, len(shows))

        # Reset trending flags — only keep current trending
        conn.execute("UPDATE titles SET is_trending = 0")
        for tid in trending_ids:
            conn.execute(
                "UPDATE titles SET is_trending = 1 WHERE tmdb_id = ?",
                (tid,)
            )

        conn.commit()
        conn.close()
        self.client.close()

        stats = {
            "movies_found": len(movies),
            "shows_found": len(shows),
            "new_movies": new_movies,
            "new_shows": new_shows,
        }
        log.info("Collection complete: %s", stats)
        return stats

    # ── Discovery ──────────────────────────────────────────────

    def _discover(self, media_type: str, max_pages: int = 50) -> list[dict]:
        """Paginate through discover endpoint for Prime NL content."""
        endpoint = f"{TMDB_BASE_URL}/discover/{media_type}"
        all_results = []

        for page in range(1, max_pages + 1):
            resp = self._get(endpoint, {
                "watch_region": WATCH_REGION,
                "with_watch_providers": str(PRIME_PROVIDER_ID),
                "with_watch_monetization_types": "flatrate",
                "sort_by": "popularity.desc",
                "language": LANGUAGE,
                "page": page,
            })
            if not resp:
                break
            data = resp
            all_results.extend(data.get("results", []))
            if page >= data.get("total_pages", 1):
                break
            time.sleep(0.26)  # Rate limit: 40 req/10s

        return all_results

    # ── Detail Fetching ────────────────────────────────────────

    def _fetch_detail(self, media_type: str, tmdb_id: int) -> dict | None:
        """Fetch full detail for a title including videos and credits."""
        endpoint = f"{TMDB_BASE_URL}/{media_type}/{tmdb_id}"
        data = self._get(endpoint, {
            "language": LANGUAGE,
            "append_to_response": "videos,credits",
        })
        if not data:
            return None

        # Extract trailer (YouTube only)
        trailer_key = None
        for video in (data.get("videos", {}).get("results", [])):
            if video.get("type") == "Trailer" and video.get("site") == "YouTube":
                trailer_key = video["key"]
                break

        # Extract top 5 cast names
        cast_names = []
        for person in (data.get("credits", {}).get("cast", []))[:5]:
            cast_names.append(person.get("name", ""))

        # Extract director (movies only)
        director = None
        if media_type == "movie":
            for person in (data.get("credits", {}).get("crew", [])):
                if person.get("job") == "Director":
                    director = person.get("name")
                    break

        # Map genre IDs to names
        genre_names = [g.get("name", "") for g in data.get("genres", [])]

        title_key = "title" if media_type == "movie" else "name"
        release_key = "release_date" if media_type == "movie" else "first_air_date"

        return {
            "tmdb_id": tmdb_id,
            "media_type": media_type,
            "title": data.get(title_key, ""),
            "overview": data.get("overview", ""),
            "genres": genre_names,
            "release_date": data.get(release_key, ""),
            "vote_average": data.get("vote_average", 0),
            "vote_count": data.get("vote_count", 0),
            "popularity": data.get("popularity", 0),
            "poster_path": data.get("poster_path"),
            "backdrop_path": data.get("backdrop_path"),
            "runtime": data.get("runtime"),
            "seasons": data.get("number_of_seasons"),
            "trailer_key": trailer_key,
            "cast_names": cast_names,
            "director": director,
        }

    # ── Trending ───────────────────────────────────────────────

    def _fetch_trending_ids(self) -> set[int]:
        """Fetch currently trending movie + TV IDs."""
        ids = set()
        for media_type in ("movie", "tv"):
            data = self._get(f"{TMDB_BASE_URL}/trending/{media_type}/week", {
                "language": LANGUAGE,
            })
            if data:
                ids.update(r["id"] for r in data.get("results", []))
        return ids

    # ── Genre Maps ─────────────────────────────────────────────

    def _load_genre_maps(self):
        """Cache genre ID→name mappings."""
        for media_type in ("movie", "tv"):
            data = self._get(f"{TMDB_BASE_URL}/genre/{media_type}/list", {
                "language": LANGUAGE,
            })
            if data:
                for g in data.get("genres", []):
                    self._genre_map[g["id"]] = g["name"]

    # ── HTTP Helper ────────────────────────────────────────────

    def _get(self, url: str, params: dict | None = None) -> dict | None:
        """Make GET request with API key."""
        params = params or {}
        params["api_key"] = self.api_key
        try:
            resp = self.client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            log.warning("TMDB request failed: %s — %s", url, e)
            return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    collector = TMDBCollector()
    result = collector.collect_all()
    print(f"Done: {result}")
