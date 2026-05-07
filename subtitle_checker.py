"""Check subtitle availability on Prime Video NL via Streaming Availability API.

Uses the Movie of the Night API (v4) to verify which titles on Prime Video NL
have English and/or Italian subtitles. Results are cached in the SQLite DB
with a 30-day TTL.

Usage:
    python subtitle_checker.py                  # default: 50 titles
    python subtitle_checker.py --max-requests 100
"""
from __future__ import annotations

import argparse
import logging
import time

import httpx

from config import STREAMING_API_KEY, STREAMING_API_BASE
from db import init_db, get_titles_needing_sub_check, update_subtitle_info

log = logging.getLogger(__name__)


def _extract_prime_subs(data: dict) -> tuple[bool | None, bool | None]:
    """Extract EN/IT subtitle availability from a Streaming Availability API response.

    Looks for Prime Video subscription streaming options in the NL market.
    Returns (has_english, has_italian).
    """
    streaming_options = data.get("streamingOptions", {})

    # NL-specific options
    nl_options = streaming_options.get("nl", [])
    if not nl_options:
        # Title not available in NL at all
        return None, None

    # Filter for Prime Video subscription options
    prime_options = [
        opt for opt in nl_options
        if opt.get("service", {}).get("id") == "prime"
        and opt.get("type") in ("subscription", "addon", "free")
    ]

    if not prime_options:
        # Not on Prime Video NL
        return None, None

    # Collect all subtitle languages across Prime options
    all_sub_langs = set()
    for opt in prime_options:
        for sub in opt.get("subtitles", []):
            locale = sub.get("locale", {})
            lang = locale.get("language", "")
            if lang:
                all_sub_langs.add(lang)

    has_english = "eng" in all_sub_langs
    has_italian = "ita" in all_sub_langs

    return has_english, has_italian


def check_subtitles(max_requests: int = 50) -> dict:
    """Check subtitle availability for titles that need verification.

    Returns stats dict with counts.
    """
    if not STREAMING_API_KEY:
        log.warning("STREAMING_API_KEY not set — skipping subtitle check")
        return {"checked": 0, "skipped": True}

    conn = init_db()
    titles = get_titles_needing_sub_check(conn, max_items=max_requests)

    if not titles:
        log.info("All titles have recent subtitle data — nothing to check")
        conn.close()
        return {"checked": 0, "all_current": True}

    log.info("Checking subtitles for %d titles (max %d)…", len(titles), max_requests)

    client = httpx.Client(timeout=15)
    headers = {
        "X-API-Key": STREAMING_API_KEY,
        "Accept": "application/json",
    }

    stats = {"checked": 0, "with_en": 0, "with_it": 0, "no_subs": 0, "errors": 0, "not_on_prime": 0}
    consecutive_429 = 0

    for i, title in enumerate(titles):
        tmdb_id = title["tmdb_id"]
        media_type = title["media_type"]

        # API uses "movie/{tmdb_id}" or "tv/{tmdb_id}" as the show ID
        show_id = f"{media_type}/{tmdb_id}"
        url = f"{STREAMING_API_BASE}/shows/{show_id}"

        try:
            resp = client.get(url, headers=headers, params={"country": "nl"})

            # Handle rate limiting with backoff
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5"))
                log.warning("  [%d/%d] Rate limited — waiting %ds", i + 1, len(titles), retry_after)
                time.sleep(retry_after)
                resp = client.get(url, headers=headers, params={"country": "nl"})

            if resp.status_code == 429:
                consecutive_429 += 1
                log.warning("  [%d/%d] %s — HTTP 429", i + 1, len(titles), title["title"])
                stats["errors"] += 1
                if consecutive_429 >= 3:
                    log.warning("No going back — quota exhausted, stopping early")
                    break
            elif resp.status_code == 404:
                consecutive_429 = 0
                # Title not found in the API — mark as checked (no data)
                update_subtitle_info(conn, tmdb_id, has_english=False, has_italian=False)
                stats["checked"] += 1
                stats["no_subs"] += 1
                log.debug("  [%d/%d] %s — not found in API", i + 1, len(titles), title["title"])
            elif resp.status_code == 200:
                consecutive_429 = 0
                data = resp.json()
                has_en, has_it = _extract_prime_subs(data)

                if has_en is None and has_it is None:
                    # Not on Prime NL — still mark as checked
                    update_subtitle_info(conn, tmdb_id, has_english=False, has_italian=False)
                    stats["not_on_prime"] += 1
                else:
                    update_subtitle_info(conn, tmdb_id, has_english=has_en, has_italian=has_it)
                    if has_en:
                        stats["with_en"] += 1
                    if has_it:
                        stats["with_it"] += 1
                    if not has_en and not has_it:
                        stats["no_subs"] += 1

                stats["checked"] += 1
                subs_str = []
                if has_en:
                    subs_str.append("EN")
                if has_it:
                    subs_str.append("IT")
                label = " + ".join(subs_str) if subs_str else "none"
                log.info("  [%d/%d] %s — subs: %s", i + 1, len(titles), title["title"], label)
            else:
                consecutive_429 = 0
                log.warning("  [%d/%d] %s — HTTP %d", i + 1, len(titles), title["title"], resp.status_code)
                stats["errors"] += 1

        except httpx.HTTPError as e:
            consecutive_429 = 0
            log.warning("  [%d/%d] %s — error: %s", i + 1, len(titles), title["title"], e)
            stats["errors"] += 1

        # Rate limit: 1.5s between requests to stay under API limits
        time.sleep(1.5)

        # Commit every 10 titles
        if (i + 1) % 10 == 0:
            conn.commit()

    conn.commit()

    # Report remaining unchecked
    remaining = get_titles_needing_sub_check(conn, max_items=1)
    total_remaining = conn.execute(
        "SELECT COUNT(*) FROM titles WHERE has_english_subs IS NULL"
    ).fetchone()[0]
    conn.close()
    client.close()

    log.info(
        "Subtitle check complete: %d checked (%d EN, %d IT, %d none, %d errors) — %d remaining",
        stats["checked"], stats["with_en"], stats["with_it"],
        stats["no_subs"], stats["errors"], total_remaining,
    )
    stats["remaining"] = total_remaining
    return stats


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    parser = argparse.ArgumentParser(description="Check subtitle availability on Prime Video NL")
    parser.add_argument("--max-requests", type=int, default=50, help="Max API requests per run")
    args = parser.parse_args()
    result = check_subtitles(max_requests=args.max_requests)
    print(f"Done: {result}")
