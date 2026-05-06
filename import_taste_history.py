#!/usr/bin/env python3
"""
import_taste_history.py

Reads the user's 'Screen list.xlsx' history, queries TMDB for metadata,
applies sentiment weights based on personal notes, and exports a pre-calculated
Taste Engine vector (my_taste.json).
"""

import openpyxl
import json
import sqlite3
import requests
import time
import os
from collections import defaultdict
from config import TMDB_API_KEY

EXCEL_PATH = '/Users/francescozaccaria/Downloads/Screen list.xlsx'
OUTPUT_PATH = 'site/data/my_taste.json'
DB_PATH = 'data/tmdb_cache.db'  # local cache for search results to avoid hammering TMDB

GENRE_SIGNAL_MAP = {
    'Action': ['action', 'mainstream'],
    'Adventure': ['action', 'mainstream'],
    'Animation': ['animation'],
    'Comedy': ['comedy'],
    'Crime': ['crime', 'thriller'],
    'Documentary': ['documentary', 'arthouse'],
    'Drama': ['drama'],
    'Family': ['mainstream'],
    'Fantasy': ['scifi', 'mainstream'],
    'History': ['classic', 'drama'],
    'Horror': ['horror'],
    'Music': ['indie'],
    'Mystery': ['thriller', 'crime'],
    'Romance': ['romance'],
    'Science Fiction': ['scifi', 'visual'],
    'Sci-Fi & Fantasy': ['scifi', 'visual'],
    'TV Movie': ['mainstream'],
    'Thriller': ['thriller'],
    'War': ['drama', 'classic'],
    'Western': ['classic'],
}

def init_cache():
    os.makedirs('data', exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS search_cache 
                 (title TEXT PRIMARY KEY, result_json TEXT)''')
    conn.commit()
    return conn

def search_tmdb(conn, title, is_series):
    title_str = str(title)
    title_clean = title_str.lower().strip()
    c = conn.cursor()
    c.execute('SELECT result_json FROM search_cache WHERE title = ?', (title_clean,))
    row = c.fetchone()
    if row:
        return json.loads(row[0])

    endpoint = "search/tv" if is_series else "search/movie"
    url = f"https://api.themoviedb.org/3/{endpoint}"
    params = {
        'api_key': TMDB_API_KEY,
        'query': title_str,
        'language': 'en-US',
        'page': 1
    }
    
    try:
        resp = requests.get(url, params=params, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        results = data.get('results', [])
        best_match = results[0] if results else None
        
        # Cache the best match
        c.execute('INSERT OR REPLACE INTO search_cache VALUES (?, ?)', 
                  (title_clean, json.dumps(best_match) if best_match else 'null'))
        conn.commit()
        time.sleep(0.05)  # rate limit safety
        return best_match
    except Exception as e:
        print(f"Error searching TMDB for '{title}': {e}")
        return None

def fetch_genres():
    # Fetch genre maps to resolve genre_ids
    url_m = f"https://api.themoviedb.org/3/genre/movie/list?api_key={TMDB_API_KEY}"
    url_t = f"https://api.themoviedb.org/3/genre/tv/list?api_key={TMDB_API_KEY}"
    
    genre_map = {}
    try:
        for u in [url_m, url_t]:
            resp = requests.get(u, timeout=5)
            for g in resp.json().get('genres', []):
                genre_map[g['id']] = g['name']
    except Exception as e:
        print("Failed to fetch genres", e)
    return genre_map

def clamp(val, min_val, max_val):
    return max(min_val, min(max_val, val))

def main():
    print(f"Reading {EXCEL_PATH}...")
    try:
        wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    except FileNotFoundError:
        print("Excel file not found!")
        return

    conn = init_cache()
    genre_map = fetch_genres()

    items = []
    
    # Parse Main Sheet
    ws1 = wb['Streaming Show List']
    for row in ws1.iter_rows(min_row=3, values_only=True):
        title = row[1]
        if not title: continue
        is_series = str(row[5]).lower() in ['series', 'tv show']
        note = str(row[9] or '').strip().lower()
        
        weight = 0.5  # default
        if 'nice' in note: weight = 1.0
        elif 'good' in note: weight = 1.5
        elif 'bellissimo' in note: weight = 2.0
        elif 'boring' in note or 'disappointing' in note or 'bad' in note: weight = -1.0
        
        items.append({'title': title, 'is_series': is_series, 'weight': weight})

    # Parse 'Visti but when'
    try:
        ws3 = wb['Visti but when']
        for row in ws3.iter_rows(min_row=3, values_only=True):
            title = row[0]
            if not title: continue
            note = str(row[3] or '').strip().lower()
            weight = 2.0 if 'bellissimo' in note else 1.0
            items.append({'title': title, 'is_series': False, 'weight': weight})
    except KeyError:
        pass

    print(f"Found {len(items)} items to process.")
    
    signals = defaultdict(float)
    decades = defaultdict(float)
    total_processed = 0

    for idx, item in enumerate(items):
        if idx % 50 == 0:
            print(f"Processing item {idx}/{len(items)}...")
            
        match = search_tmdb(conn, item['title'], item['is_series'])
        if not match:
            # Fallback try opposite type
            match = search_tmdb(conn, item['title'], not item['is_series'])
            
        if not match:
            continue
            
        total_processed += 1
        
        # Apply genre signals
        g_ids = match.get('genre_ids', [])
        resolved_genres = [genre_map.get(gid) for gid in g_ids if gid in genre_map]
        
        # Apply weight to signals
        normalized = item['weight'] * 0.1  # scale down to avoid instantly maxing out 1.0
        
        for g in resolved_genres:
            mapped = GENRE_SIGNAL_MAP.get(g, [])
            for s in mapped:
                signals[s] += normalized
                
        # Decade
        date_str = match.get('release_date') or match.get('first_air_date')
        if date_str and len(date_str) >= 4:
            year = int(date_str[:4])
            decade = f"{year - (year % 10)}s"
            decades[decade] += normalized

    # Normalize final vector (clamp between -1 and 1)
    # We use a soft scaling to maintain relative strength
    max_sig = max([abs(v) for v in signals.values()] + [1.0])
    for s in signals:
        signals[s] = clamp(signals[s] / max_sig, -1, 1)
        
    max_dec = max([abs(v) for v in decades.values()] + [1.0])
    for d in decades:
        decades[d] = clamp(decades[d] / max_dec, -1, 1)

    # Compute adventurousness (bias towards arthouse/indie/international)
    niche_signals = ['arthouse', 'international', 'european', 'indie', 'auteur']
    niche_avg = sum(max(0, signals.get(s, 0)) for s in niche_signals) / len(niche_signals)
    adventurousness = clamp(niche_avg * 2 + 0.5, 0, 1)  # boost baseline

    taste_vector = {
        "signals": dict(signals),
        "decades": dict(decades),
        "adventurousness": adventurousness,
        "totalRatings": total_processed,
        "lastUpdated": None,
        "source": "excel_import"
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(taste_vector, f, indent=2)

    print(f"\n✅ Finished! Processed {total_processed} items.")
    print("Top Signals:")
    top = sorted(signals.items(), key=lambda x: x[1], reverse=True)[:5]
    for k, v in top:
        print(f"  {k}: {v:.2f}")
    
    print(f"Exported taste vector to {OUTPUT_PATH}")

if __name__ == '__main__':
    main()
