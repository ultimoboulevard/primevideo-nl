#!/usr/bin/env python3
"""CLI entrypoint for NirvanAI pipeline."""
from __future__ import annotations

import argparse
import logging
import sys
import webbrowser
from pathlib import Path


def cmd_collect(args):
    """Fetch latest data from TMDB API."""
    from collector import TMDBCollector
    collector = TMDBCollector()
    stats = collector.collect_all()
    print(f"Collection complete: {stats}")


def cmd_taste_sync(args):
    """Sync taste profile from TMDB user ratings."""
    from taste_sync import sync_taste
    result = sync_taste()
    print(f"Taste sync: {result['tmdbRatings']} TMDB ratings, "
          f"{result['totalRatings']} total, "
          f"{len(result['signals'])} signals")


def cmd_export(args):
    """Sync taste + export database to JSON for static site."""
    # Auto-sync taste profile before exporting
    from taste_sync import sync_taste
    try:
        sync_taste()
    except Exception as e:
        logging.getLogger(__name__).warning("Taste sync failed (non-fatal): %s", e)
    from export_json import export_catalog_json
    path = export_catalog_json()
    print(f"Exported to {path}")


def cmd_digest(args):
    """Generate HTML digest."""
    from html_builder import build_digest_html
    html = build_digest_html(days=getattr(args, "days", 7))
    out = Path("output/digest.html")
    out.parent.mkdir(exist_ok=True)
    out.write_text(html)
    print(f"Digest written to {out}")
    return html


def cmd_send(args):
    """Collect + export + build digest + send email."""
    cmd_collect(args)
    cmd_export(args)
    html = cmd_digest(args)
    from mailer import send_digest
    send_digest(html)


def cmd_site(args):
    """Export JSON and serve site locally."""
    cmd_export(args)
    import http.server
    import threading
    site_dir = Path(__file__).parent / "site"
    port = 8889

    handler = lambda *a: http.server.SimpleHTTPRequestHandler(*a, directory=str(site_dir))
    server = http.server.HTTPServer(("", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    url = f"http://localhost:{port}/"
    print(f"Serving at {url}")
    webbrowser.open(url)

    try:
        thread.join()
    except KeyboardInterrupt:
        server.shutdown()
        print("\nServer stopped.")


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    parser = argparse.ArgumentParser(description="NirvanAI Pipeline")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("collect", help="Fetch from TMDB API")
    sub.add_parser("export", help="Sync taste + export DB to JSON")
    sub.add_parser("taste-sync", help="Sync taste profile from TMDB ratings")

    p_digest = sub.add_parser("digest", help="Generate HTML digest")
    p_digest.add_argument("--days", type=int, default=7)

    p_send = sub.add_parser("send", help="Collect + digest + email")
    p_send.add_argument("--days", type=int, default=7)

    sub.add_parser("site", help="Serve site locally")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    {
        "collect": cmd_collect,
        "export": cmd_export,
        "taste-sync": cmd_taste_sync,
        "digest": cmd_digest,
        "send": cmd_send,
        "site": cmd_site,
    }[args.command](args)


if __name__ == "__main__":
    main()
