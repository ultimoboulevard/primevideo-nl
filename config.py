"""Configuration constants for Prime Video NL pipeline."""
from __future__ import annotations

import os
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
SITE_DIR = BASE_DIR / "site"
SITE_DATA_DIR = SITE_DIR / "data"
DB_PATH = DATA_DIR / "primevideo.db"

# ── TMDB API ───────────────────────────────────────────────────
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "8906d69b5882c693d04af4c7c8282fc9")
TMDB_BASE_URL = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"

# TMDB user account (for syncing personal ratings)
TMDB_ACCOUNT_ID = 23099399
TMDB_SESSION_ID = os.environ.get("TMDB_SESSION_ID", "db41ced2650c70a843231898f18850fe4f9daca0")

# Prime Video NL = provider_id 119, MUBI NL = provider_id 11 on TMDB
PRIME_PROVIDER_ID = 119
PROVIDERS = {
    "prime": {"id": 119, "label": "Prime Video", "badge": "▶"},
    "mubi":  {"id": 11,  "label": "MUBI",         "badge": "Ⓜ"},
}
WATCH_REGION = "NL"
LANGUAGE = "en-US"

# ── Email ──────────────────────────────────────────────────────
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
EMAIL_USER = os.environ.get("EMAIL_USER", "")
EMAIL_PASS = os.environ.get("EMAIL_PASS", "")
EMAIL_RECIPIENT = "francescozaccaria@me.com"

# ── Streaming Availability API (subtitle check) ───────────────
STREAMING_API_KEY = "motn-key-v4-xsoMYC9kh9r5NJpLVn9fpzFTHMf6qcLT"
STREAMING_API_BASE = "https://api.movieofthenight.com/v4"

# ── Site ───────────────────────────────────────────────────────
SITE_URL = "https://ultimoboulevard.github.io/primevideo-nl/"
