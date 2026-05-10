"""Email HTML builder for Prime Video NL weekly digest."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from config import TMDB_IMAGE_BASE, SITE_URL
from db import init_db, get_new_this_week, get_trending, get_stats

log = logging.getLogger(__name__)


def build_digest_html(days: int = 7) -> str:
    """Build a styled HTML email with the week's new content."""
    conn = init_db()
    new_titles = get_new_this_week(conn, days)
    trending = get_trending(conn)
    stats = get_stats(conn)
    conn.close()

    today = datetime.utcnow()
    week_start = (today - timedelta(days=days)).strftime("%b %d")
    week_end = today.strftime("%b %d, %Y")

    new_movies = [t for t in new_titles if t["media_type"] == "movie"]
    new_shows = [t for t in new_titles if t["media_type"] == "tv"]

    # Limit trending to top 8 for email
    trending = trending[:8]

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;">
<tr><td align="center" style="padding:20px 10px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#12121a;border-radius:16px;overflow:hidden;">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#0d1117 100%);padding:32px 24px;text-align:center;">
<h1 style="margin:0;color:#e0e0e0;font-size:24px;font-weight:700;">🎬 Prime Video NL</h1>
<p style="margin:8px 0 0;color:#888;font-size:14px;">What's New · {week_start} – {week_end}</p>
</td></tr>

<!-- Stats -->
<tr><td style="padding:16px 24px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="center" style="padding:12px;background:#1a1a2e;border-radius:8px;">
<div style="color:#00d4aa;font-size:24px;font-weight:700;">{len(new_movies)}</div>
<div style="color:#888;font-size:11px;text-transform:uppercase;">New Films</div>
</td>
<td width="8"></td>
<td align="center" style="padding:12px;background:#1a1a2e;border-radius:8px;">
<div style="color:#7c5cfc;font-size:24px;font-weight:700;">{len(new_shows)}</div>
<div style="color:#888;font-size:11px;text-transform:uppercase;">New Series</div>
</td>
<td width="8"></td>
<td align="center" style="padding:12px;background:#1a1a2e;border-radius:8px;">
<div style="color:#ff6b6b;font-size:24px;font-weight:700;">{stats['total']}</div>
<div style="color:#888;font-size:11px;text-transform:uppercase;">Total Catalog</div>
</td>
</tr>
</table>
</td></tr>
"""

    # Trending section
    if trending:
        html += """
<tr><td style="padding:20px 24px 8px;">
<h2 style="margin:0;color:#ff6b6b;font-size:16px;font-weight:600;">🔥 Trending Now</h2>
</td></tr>
"""
        for t in trending:
            html += _build_title_row(t)

    # New Movies
    if new_movies:
        html += """
<tr><td style="padding:20px 24px 8px;">
<h2 style="margin:0;color:#00d4aa;font-size:16px;font-weight:600;">🆕 New Movies</h2>
</td></tr>
"""
        for t in new_movies[:10]:
            html += _build_title_row(t)

    # New TV Shows
    if new_shows:
        html += """
<tr><td style="padding:20px 24px 8px;">
<h2 style="margin:0;color:#7c5cfc;font-size:16px;font-weight:600;">📺 New Series</h2>
</td></tr>
"""
        for t in new_shows[:10]:
            html += _build_title_row(t)

    # No new content fallback
    if not new_movies and not new_shows and not trending:
        html += """
<tr><td style="padding:40px 24px;text-align:center;">
<p style="color:#888;font-size:14px;">No new titles added this week.<br>
Check the <a href="{SITE_URL}" style="color:#00d4aa;">full catalog</a> for browsing.</p>
</td></tr>
"""

    # Footer
    html += f"""
<!-- CTA -->
<tr><td style="padding:20px 24px;" align="center">
<a href="{SITE_URL}" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#7c5cfc,#00d4aa);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Browse Full Catalog →</a>
</td></tr>

<!-- Footer -->
<tr><td style="padding:16px 24px;border-top:1px solid #1a1a2e;text-align:center;">
<p style="margin:0;color:#555;font-size:11px;">Powered by TMDB · Updated daily · Prime Video NL</p>
</td></tr>

</table>
</td></tr></table>
</body></html>"""

    return html


def _build_title_row(t: dict) -> str:
    """Build a single title row for the email."""
    poster_url = f"{TMDB_IMAGE_BASE}/w154{t['poster_path']}" if t.get("poster_path") else ""
    genres = ", ".join(t.get("genres", [])[:2]) if t.get("genres") else ""
    rating = f"★ {t.get('vote_average', 0):.1f}" if t.get("vote_average") else ""

    meta_parts = []
    if rating:
        meta_parts.append(rating)
    if genres:
        meta_parts.append(genres)
    if t["media_type"] == "movie" and t.get("runtime"):
        h, m = divmod(t["runtime"], 60)
        meta_parts.append(f"{h}h{m:02d}" if h else f"{m}min")
    elif t["media_type"] == "tv" and t.get("seasons"):
        meta_parts.append(f"S{t['seasons']}")
    meta = " · ".join(meta_parts)

    overview = (t.get("overview") or "")[:120]
    if len(t.get("overview", "")) > 120:
        overview += "…"

    poster_html = ""
    if poster_url:
        poster_html = f'<td width="60" valign="top"><img src="{poster_url}" width="60" style="border-radius:6px;display:block;" alt=""></td><td width="12"></td>'

    return f"""
<tr><td style="padding:8px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:10px;overflow:hidden;">
<tr><td style="padding:12px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
{poster_html}
<td valign="top">
<div style="color:#e0e0e0;font-size:14px;font-weight:600;margin-bottom:4px;">{t['title']}</div>
<div style="color:#888;font-size:11px;margin-bottom:4px;">{meta}</div>
<div style="color:#666;font-size:11px;line-height:1.4;">{overview}</div>
</td>
</tr>
</table>
</td></tr>
</table>
</td></tr>
"""


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    html = build_digest_html()
    from pathlib import Path
    out = Path("output/digest.html")
    out.parent.mkdir(exist_ok=True)
    out.write_text(html)
    print(f"Digest written to {out}")
