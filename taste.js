/* ── Taste Engine — Cold Start Personalization ────────────────── */
'use strict';

const TasteEngine = (() => {
    // ── Storage Keys ──────────────────────────────────────────
    const STORAGE_KEY = 'pvnl_taste';
    const ONBOARDING_KEY = 'pvnl_onboarding_done';
    const RATINGS_KEY = 'pvnl_ratings';        // { tmdb_id: score (1-10) }
    const SIGNALS_KEY = 'pvnl_signals';        // behavioral log
    const LAST_DECAY_KEY = 'pvnl_last_decay';

    // ── Seed Films for Onboarding Quiz ────────────────────────
    // Each is taste-diagnostic: genre-spanning, widely-known
    const SEED_FILMS = [
        {
            id: 238, title: 'The Godfather', year: 1972,
            poster: 'https://image.tmdb.org/t/p/w300/3bhkrj58Vtu7enYsRolD1fZdja1.jpg',
            genres: ['Crime', 'Drama'],
            reveals: 'Classic cinema',
            decade: '1970s',
            signals: { classic: 1, crime: 1, drama: 1 }
        },
        {
            id: 496243, title: 'Parasite', year: 2019,
            poster: 'https://image.tmdb.org/t/p/w300/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
            genres: ['Thriller', 'Comedy', 'Drama'],
            reveals: 'International / arthouse',
            decade: '2010s',
            signals: { international: 1, arthouse: 1, thriller: 1 }
        },
        {
            id: 155, title: 'The Dark Knight', year: 2008,
            poster: 'https://image.tmdb.org/t/p/w300/qJ2tW6WMUDux911BXJQ209FU2Qe.jpg',
            genres: ['Action', 'Crime', 'Drama'],
            reveals: 'Mainstream blockbuster',
            decade: '2000s',
            signals: { mainstream: 1, action: 1, crime: 1 }
        },
        {
            id: 376867, title: 'Moonlight', year: 2016,
            poster: 'https://image.tmdb.org/t/p/w300/4911T5FbJ9eD2Faz5Z8cT3SUhU3.jpg',
            genres: ['Drama'],
            reveals: 'Indie / art film',
            decade: '2010s',
            signals: { arthouse: 1, indie: 1, drama: 1 }
        },
        {
            id: 194, title: 'Amélie', year: 2001,
            poster: 'https://image.tmdb.org/t/p/w300/slVnvaH9rK7JOmPRFuXQCnZZBGQ.jpg',
            genres: ['Comedy', 'Romance'],
            reveals: 'European cinema',
            decade: '2000s',
            signals: { international: 1, european: 1, romance: 1 }
        },
        {
            id: 6977, title: 'No Country for Old Men', year: 2007,
            poster: 'https://image.tmdb.org/t/p/w300/bj1v6YKF8yHqA489GFiMqTD1aSe.jpg',
            genres: ['Crime', 'Drama', 'Thriller'],
            reveals: 'Dark tone / Coen Brothers',
            decade: '2000s',
            signals: { arthouse: 0.5, thriller: 1, crime: 1 }
        },
        {
            id: 335984, title: 'Blade Runner 2049', year: 2017,
            poster: 'https://image.tmdb.org/t/p/w300/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg',
            genres: ['Science Fiction', 'Drama'],
            reveals: 'Sci-fi / visual storytelling',
            decade: '2010s',
            signals: { scifi: 1, visual: 1, arthouse: 0.5 }
        },
        {
            id: 64690, title: 'Drive', year: 2011,
            poster: 'https://image.tmdb.org/t/p/w300/602vevIURmpDfzbnv5Ubi6wIkQm.jpg',
            genres: ['Drama', 'Thriller', 'Crime'],
            reveals: 'Stylistic / auteur',
            decade: '2010s',
            signals: { auteur: 1, visual: 1, thriller: 1 }
        },
        {
            id: 120467, title: 'The Grand Budapest Hotel', year: 2014,
            poster: 'https://image.tmdb.org/t/p/w300/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg',
            genres: ['Comedy', 'Drama'],
            reveals: 'Wes Anderson / quirky',
            decade: '2010s',
            signals: { auteur: 1, comedy: 1, visual: 1 }
        },
        {
            id: 419430, title: 'Get Out', year: 2017,
            poster: 'https://image.tmdb.org/t/p/w300/qBaIVyDEL2sPIahKPmIkJCpceNn.jpg',
            genres: ['Horror', 'Thriller', 'Mystery'],
            reveals: 'Horror / social commentary',
            decade: '2010s',
            signals: { horror: 1, thriller: 1, social: 1 }
        },
        {
            id: 531428, title: 'Portrait of a Lady on Fire', year: 2019,
            poster: 'https://image.tmdb.org/t/p/w300/2LquGwEhbg3soxSCs9VuGnFAsyq.jpg',
            genres: ['Drama', 'Romance'],
            reveals: 'Slow cinema / intimacy',
            decade: '2010s',
            signals: { arthouse: 1, european: 1, international: 1, romance: 0.5 }
        },
        {
            id: 244786, title: 'Whiplash', year: 2014,
            poster: 'https://image.tmdb.org/t/p/w300/7fn624j5lj3xTme2SgiLCeuedmO.jpg',
            genres: ['Drama', 'Music'],
            reveals: 'Intensity / music',
            decade: '2010s',
            signals: { indie: 1, drama: 1, intense: 1 }
        },
    ];

    // ── Genre → Signal mapping ────────────────────────────────
    // Maps TMDB genre names to internal taste signals
    const GENRE_SIGNAL_MAP = {
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
        'TV Movie': ['mainstream'],
        'Thriller': ['thriller'],
        'War': ['drama', 'classic'],
        'Western': ['classic'],
    };

    // ── Default taste vector ──────────────────────────────────
    function defaultTaste() {
        return {
            // Dimensional affinities (-1 to +1 scale)
            signals: {
                action: 0, drama: 0, comedy: 0, thriller: 0,
                crime: 0, romance: 0, horror: 0, scifi: 0,
                animation: 0, documentary: 0,
                // Style dimensions
                arthouse: 0, mainstream: 0, international: 0,
                european: 0, indie: 0, visual: 0, auteur: 0,
                classic: 0, social: 0, intense: 0,
            },
            // Decade preference
            decades: {},
            // Computed flags
            adventurousness: 0.5,
            // Metadata
            totalRatings: 0,
            lastUpdated: null,
        };
    }

    // ── Load / Save ───────────────────────────────────────────
    function loadTaste() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                // Merge with defaults to handle new signals
                const taste = defaultTaste();
                Object.assign(taste.signals, parsed.signals || {});
                Object.assign(taste.decades, parsed.decades || {});
                taste.adventurousness = parsed.adventurousness ?? 0.5;
                taste.totalRatings = parsed.totalRatings || 0;
                taste.lastUpdated = parsed.lastUpdated;
                return taste;
            }
        } catch (e) { /* corrupt data → fresh start */ }
        return defaultTaste();
    }

    function saveTaste(taste) {
        taste.lastUpdated = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(taste));
    }

    function loadRatings() {
        try {
            return JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}');
        } catch { return {}; }
    }

    function saveRatings(ratings) {
        localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));
    }

    function isOnboardingDone() {
        return localStorage.getItem(ONBOARDING_KEY) === 'true';
    }

    function markOnboardingDone() {
        localStorage.setItem(ONBOARDING_KEY, 'true');
    }

    // ── Phase 1: Process quiz rating ──────────────────────────
    function processQuizRating(seedFilm, score) {
        // score: 1-10, null = skip
        const taste = loadTaste();
        const ratings = loadRatings();

        if (score === null) return; // Skip = no signal (haven't seen it)

        ratings[seedFilm.id] = score;
        saveRatings(ratings);

        // Normalize score: 1-10 → -1 to +1
        // 5.5 is neutral center
        const normalized = (score - 5.5) / 4.5;

        // Apply to relevant signals
        const weight = 2.0; // Quiz ratings are strong signals
        Object.entries(seedFilm.signals).forEach(([signal, strength]) => {
            if (taste.signals[signal] !== undefined) {
                taste.signals[signal] = clamp(
                    taste.signals[signal] + normalized * strength * weight,
                    -1, 1
                );
            }
        });

        // Apply genre signals
        (seedFilm.genres || []).forEach(genre => {
            const mapped = GENRE_SIGNAL_MAP[genre] || [];
            mapped.forEach(signal => {
                if (taste.signals[signal] !== undefined) {
                    taste.signals[signal] = clamp(
                        taste.signals[signal] + normalized * 0.5,
                        -1, 1
                    );
                }
            });
        });

        // Decade affinity
        if (seedFilm.decade) {
            taste.decades[seedFilm.decade] = clamp(
                (taste.decades[seedFilm.decade] || 0) + normalized * 0.5,
                -1, 1
            );
        }

        taste.totalRatings++;

        // Compute adventurousness: how many niche signals are positive?
        const nicheSignals = ['arthouse', 'international', 'european', 'indie', 'auteur'];
        const nicheAvg = nicheSignals.reduce((sum, s) => sum + Math.max(0, taste.signals[s] || 0), 0) / nicheSignals.length;
        taste.adventurousness = clamp(nicheAvg * 2, 0, 1);

        saveTaste(taste);
    }

    // ── Phase 2: Record behavioral signal ─────────────────────
    function recordSignal(action, title) {
        // title = catalog item from CATALOG
        if (!title || !title.genres) return;

        const taste = loadTaste();

        // Action → weight mapping
        const WEIGHTS = {
            'click_poster': 0.15,        // Viewed detail
            'add_watchlist': 0.5,        // Strong interest
            'remove_watchlist': -0.25,   // Changed mind
            'play_trailer': 0.3,        // Active engagement
            'long_view': 0.1,           // >10s on detail modal
            'rate': 0,                   // Handled by processRating()
        };

        const weight = WEIGHTS[action];
        if (weight === undefined || weight === 0) return;

        // Apply to genre signals
        (title.genres || []).forEach(genre => {
            const mapped = GENRE_SIGNAL_MAP[genre] || [];
            mapped.forEach(signal => {
                if (taste.signals[signal] !== undefined) {
                    taste.signals[signal] = clamp(
                        taste.signals[signal] + weight * 0.3,
                        -1, 1
                    );
                }
            });
        });

        saveTaste(taste);
    }

    // ── Phase 2: Process explicit rating (n/10) ───────────────
    function processRating(titleId, score, title) {
        // score: 1-10
        const taste = loadTaste();
        const ratings = loadRatings();

        ratings[titleId] = score;
        saveRatings(ratings);

        const normalized = (score - 5.5) / 4.5;
        const weight = 1.5; // Explicit ratings are strong

        (title.genres || []).forEach(genre => {
            const mapped = GENRE_SIGNAL_MAP[genre] || [];
            mapped.forEach(signal => {
                if (taste.signals[signal] !== undefined) {
                    taste.signals[signal] = clamp(
                        taste.signals[signal] + normalized * weight * 0.4,
                        -1, 1
                    );
                }
            });
        });

        taste.totalRatings++;
        saveTaste(taste);
    }

    // ── Phase 0+2: Compute affinity score for a title ─────────
    function computeAffinity(title, interestScore) {
        const taste = loadTaste();
        const ratings = loadRatings();

        // Phase 0: Base score = interest_score (0-100)
        let score = (interestScore || title.interest_score || 50);

        // If no taste data yet, return interest_score only
        if (taste.totalRatings === 0 && !taste.lastUpdated) {
            return score;
        }

        // Phase 1+2: Taste affinity modifier (-30 to +30)
        let affinityBoost = 0;
        let matchedSignals = 0;

        (title.genres || []).forEach(genre => {
            const mapped = GENRE_SIGNAL_MAP[genre] || [];
            mapped.forEach(signal => {
                const affinity = taste.signals[signal] || 0;
                affinityBoost += affinity * 15; // Scale to meaningful range
                matchedSignals++;
            });
        });

        if (matchedSignals > 0) {
            affinityBoost /= matchedSignals;
        }

        // Already rated? Penalize slightly (seen it)
        if (ratings[title.id]) {
            affinityBoost -= 5;
        }

        score += affinityBoost;
        return clamp(score, 0, 100);
    }

    // ── Decay function (Phase 2) ──────────────────────────────
    function maybeDecay() {
        const lastDecay = localStorage.getItem(LAST_DECAY_KEY);
        const now = Date.now();
        const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

        if (lastDecay && (now - parseInt(lastDecay)) < WEEK_MS) return;

        const taste = loadTaste();
        // Decay all behavioral signals by 10%
        Object.keys(taste.signals).forEach(s => {
            taste.signals[s] *= 0.9;
        });
        Object.keys(taste.decades).forEach(d => {
            taste.decades[d] *= 0.9;
        });
        saveTaste(taste);
        localStorage.setItem(LAST_DECAY_KEY, now.toString());
    }

    // ── Get rating for a title ────────────────────────────────
    function getRating(titleId) {
        const ratings = loadRatings();
        return ratings[titleId] || null;
    }

    // ── Get current taste vector (for debug/display) ──────────
    function getTasteVector() {
        return loadTaste();
    }

    // ── Get onboarding rated count ────────────────────────────
    function getQuizRatedCount() {
        const ratings = loadRatings();
        return SEED_FILMS.filter(f => ratings[f.id] !== undefined).length;
    }

    // ── Reset everything ──────────────────────────────────────
    function reset() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(ONBOARDING_KEY);
        localStorage.removeItem(RATINGS_KEY);
        localStorage.removeItem(SIGNALS_KEY);
        localStorage.removeItem(LAST_DECAY_KEY);
    }

    // ── Inject Taste (Bootstrap) ──────────────────────────────
    function injectTaste(taste) {
        saveTaste(taste);
        markOnboardingDone();
    }

    // ── Utility ───────────────────────────────────────────────
    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    // ── Run decay on load ─────────────────────────────────────
    maybeDecay();

    // ── Public API ────────────────────────────────────────────
    return {
        SEED_FILMS,
        isOnboardingDone,
        markOnboardingDone,
        processQuizRating,
        processRating,
        getRating,
        recordSignal,
        computeAffinity,
        getTasteVector,
        getQuizRatedCount,
        injectTaste,
        reset,
    };
})();
