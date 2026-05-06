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

# Prime Video NL = provider_id 119 on TMDB
PRIME_PROVIDER_ID = 119
WATCH_REGION = "NL"
LANGUAGE = "en-US"

# ── Email ──────────────────────────────────────────────────────
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
EMAIL_USER = os.environ.get("EMAIL_USER", "")
EMAIL_PASS = os.environ.get("EMAIL_PASS", "")
EMAIL_RECIPIENT = "francescozaccaria@me.com"

# ── Site ───────────────────────────────────────────────────────
SITE_URL = "https://ultimoboulevard.github.io/primevideo-nl/"
