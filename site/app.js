/* ── NirvanAI — Personalized Cinema Discovery ────────────────── */
'use strict';

let CATALOG = [];
let GENRES = [];
let WATCHLIST = new Set(JSON.parse(localStorage.getItem('pvnl_watchlist') || '[]'));

// ── State ─────────────────────────────────────────────────────
let state = {
    typeFilter: 'all',      // all | movie | tv
    genreFilter: null,       // null or genre string
    providerFilter: null,    // null | 'prime' | 'mubi'
    sortBy: 'popularity',    // popularity | rating | newest | az
    specialFilter: null,     // null | trending | new | watchlist
    searchQuery: '',
    viewMode: 'grid',        // grid | list
    gridPage: 0,
    gridPageSize: 40,
};

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    fetch('data/catalog.json')
        .then(r => r.json())
        .then(data => {
            CATALOG = data.catalog || [];
            GENRES = data.genres || [];
            renderStats(data.stats);
            buildGenreMenu();
            renderHero();
            renderCuratedSections();
            renderCatalogGrid();
            bindEvents();
            // ── Taste Engine init ──────────────────
            fetch('data/my_taste.json')
                .then(r => {
                    if (r.ok) return r.json();
                    throw new Error('No bootstrap');
                })
                .then(bootstrap => {
                    const local = TasteEngine.getTasteVector();
                    const bootstrapRatings = bootstrap.totalRatings || 0;
                    // Always prefer the richer profile source
                    if (bootstrapRatings > (local.totalRatings || 0)) {
                        TasteEngine.injectTaste(bootstrap);
                        console.log(`Taste profile bootstrapped from Excel history (${bootstrapRatings} titles vs ${local.totalRatings || 0} local)`);
                    }
                    // Activate taste sort if we have any taste data
                    if (TasteEngine.getTasteVector().totalRatings > 0) {
                        state.sortBy = 'foryou';
                        document.getElementById('sortBtn').textContent = `Sort: ✨ For You ▾`;
                        document.querySelectorAll('#sortMenu .dropdown-item').forEach(b => {
                            b.classList.toggle('active', b.dataset.sort === 'foryou');
                        });
                        // Re-render sections with taste data
                        renderHero();
                        renderCuratedSections();
                        renderCatalogGrid();
                        renderStats(null); // refresh taste-aware stats
                    }
                    updateTasteIndicator();
                    OnboardingQuiz.scheduleShow();
                })
                .catch(() => {
                    updateTasteIndicator();
                    OnboardingQuiz.scheduleShow();
                });
        })
        .catch(err => {
            console.error('Failed to load catalog:', err);
            document.getElementById('catalogGrid').innerHTML =
                '<div class="no-results"><div class="no-results-icon">📡</div>Failed to load catalog data.</div>';
        });
});

// ── Stats ─────────────────────────────────────────────────────
function renderStats(stats) {
    if (stats) {
        document.getElementById('statTotal').innerHTML = `<strong>${stats.total}</strong> titles`;
        document.getElementById('statMovies').innerHTML = `<strong>${stats.movies}</strong> movies`;
        document.getElementById('statShows').innerHTML = `<strong>${stats.tv_shows}</strong> series`;
    }
    // Taste-aware stats replace old trending/new counts
    const taste = TasteEngine.getTasteVector();
    const el4 = document.getElementById('statTaste');
    const el5 = document.getElementById('statPersonalized');
    if (el4 && taste.totalRatings > 0) {
        const topSig = Object.entries(taste.signals)
            .filter(([_, v]) => v > 0.05)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 2)
            .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
        el4.innerHTML = `✨ <strong>${topSig.join(' · ')}</strong>`;
    }
    if (el5 && taste.totalRatings > 0) {
        el5.innerHTML = `🎯 <strong>${taste.totalRatings}</strong> analyzed`;
    }
}

// ── Genre Menu ────────────────────────────────────────────────
function buildGenreMenu() {
    const menu = document.getElementById('genreMenu');
    const allBtn = document.createElement('button');
    allBtn.className = 'dropdown-item active';
    allBtn.textContent = 'All Genres';
    allBtn.dataset.genre = '';
    allBtn.addEventListener('click', () => selectGenre(null, allBtn));
    menu.appendChild(allBtn);

    GENRES.forEach(g => {
        const btn = document.createElement('button');
        btn.className = 'dropdown-item';
        btn.textContent = g;
        btn.dataset.genre = g;
        btn.addEventListener('click', () => selectGenre(g, btn));
        menu.appendChild(btn);
    });
}

function selectGenre(genre, btn) {
    state.genreFilter = genre;
    state.gridPage = 0;
    document.querySelectorAll('#genreMenu .dropdown-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('genreBtn').textContent = genre ? `${genre} ▾` : 'Genre ▾';
    document.getElementById('genreDropdown').classList.remove('open');
    renderCatalogGrid();
}

// ── Hero Carousel ─────────────────────────────────────────────
let heroIndex = 0;
let heroInterval = null;

function renderHero() {
    // Hero uses top affinity picks that have a backdrop
    const hasTaste = TasteEngine.getTasteVector().totalRatings > 0;
    let heroPool;
    if (hasTaste) {
        heroPool = [...CATALOG]
            .filter(t => t.backdrop)
            .sort((a, b) => TasteEngine.computeAffinity(b, b.interest_score) - TasteEngine.computeAffinity(a, a.interest_score))
            .slice(0, 8);
    } else {
        heroPool = CATALOG.filter(t => t.backdrop && t.trending).slice(0, 6);
        if (!heroPool.length) {
            heroPool = [...CATALOG].filter(t => t.backdrop)
                .sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 6);
        }
    }

    if (!heroPool.length) {
        document.getElementById('heroSection').style.display = 'none';
        return;
    }

    const carousel = document.getElementById('heroCarousel');
    const dots = document.getElementById('heroDots');
    carousel.innerHTML = '';
    dots.innerHTML = '';
    if (heroInterval) clearInterval(heroInterval);

    heroPool.forEach((t, i) => {
        const slide = document.createElement('div');
        slide.className = 'hero-slide';
        const genres = (t.genres || []).slice(0, 2).join(', ');
        const year = t.date ? t.date.substring(0, 4) : '';
        const rating = t.rating ? `<span class="rating-star">★</span> ${t.rating}` : '';
        const meta = [rating, year, genres, t.type === 'movie' ? '🎬 Film' : '📺 Series'].filter(Boolean).join(' · ');
        const badge = hasTaste ? '✨ Picked For You' : '🔥 Top Pick';

        slide.innerHTML = `
            <div class="hero-slide-bg" style="background-image:url('${t.backdrop}')"></div>
            <div class="hero-slide-content">
                <div class="hero-badge">${badge}</div>
                <h2 class="hero-title">${escHtml(t.title)}</h2>
                <div class="hero-meta">${meta}</div>
                <p class="hero-overview">${escHtml(t.overview || '')}</p>
            </div>
        `;
        slide.addEventListener('click', () => openModal(t));
        carousel.appendChild(slide);

        const dot = document.createElement('div');
        dot.className = 'hero-dot' + (i === 0 ? ' active' : '');
        dot.addEventListener('click', () => goToHeroSlide(i));
        dots.appendChild(dot);
    });

    heroInterval = setInterval(() => {
        goToHeroSlide((heroIndex + 1) % heroPool.length);
    }, 6000);
}

function goToHeroSlide(idx) {
    heroIndex = idx;
    document.getElementById('heroCarousel').style.transform = `translateX(-${idx * 100}%)`;
    document.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}


// ── Curated Sections (replaces Trending/New rows) ────────────────
// Maps internal taste signals to display genre names
const SIGNAL_TO_GENRE = {
    drama: 'Drama', comedy: 'Comedy', thriller: 'Thriller', crime: 'Crime',
    action: 'Action', romance: 'Romance', horror: 'Horror', scifi: 'Science Fiction',
    animation: 'Animation', documentary: 'Documentary',
};

function renderCuratedSections() {
    const taste = TasteEngine.getTasteVector();
    const hasTaste = taste.totalRatings > 0;

    // Track used IDs to avoid duplicates across curated rows
    const usedIds = new Set();

    // ── Row 1: Top Picks For You ───────────────────────────────
    const topPicks = [...CATALOG]
        .sort((a, b) => TasteEngine.computeAffinity(b, b.interest_score) - TasteEngine.computeAffinity(a, a.interest_score))
        .filter(t => { if (usedIds.has(t.id)) return false; return true; })
        .slice(0, 24);
    topPicks.forEach(t => usedIds.add(t.id));
    const topPicksRow = document.getElementById('topPicksRow');
    topPicksRow.innerHTML = topPicks.map(t => buildPosterCard(t)).join('');
    bindPosterEvents(topPicksRow);
    if (hasTaste) {
        document.getElementById('topPicksTitle').textContent = '✨ Top Picks For You';
        document.getElementById('topPicksSubtitle').textContent =
            `${taste.totalRatings} titles rated · personalized`;
    } else {
        document.getElementById('topPicksTitle').textContent = '🏆 Top Rated';
        document.getElementById('topPicksSubtitle').textContent = 'Highest quality in the catalog';
    }

    // ── Row 2: Because You Love… ────────────────────────────
    const topSignal = Object.entries(taste.signals)
        .filter(([k]) => SIGNAL_TO_GENRE[k])
        .sort(([, a], [, b]) => b - a)[0];
    const becauseSection = document.getElementById('becauseSection');
    const becauseRow = document.getElementById('becauseRow');
    if (topSignal && topSignal[1] > 0.05) {
        const [signal, strength] = topSignal;
        const genre = SIGNAL_TO_GENRE[signal];
        document.getElementById('becauseTitle').textContent = `🎭 Because You Love ${genre}`;
        document.getElementById('becauseSubtitle').textContent =
            `Your #1 taste dimension (${Math.round(strength * 100)}% affinity)`;
        const gf = genre.toLowerCase();
        const becauseItems = [...CATALOG]
            .filter(t => (t.genres || []).some(g => g.toLowerCase().includes(gf)))
            .filter(t => !usedIds.has(t.id))
            .sort((a, b) => TasteEngine.computeAffinity(b, b.interest_score) - TasteEngine.computeAffinity(a, a.interest_score))
            .slice(0, 24);
        becauseItems.forEach(t => usedIds.add(t.id));
        becauseRow.innerHTML = becauseItems.map(t => buildPosterCard(t)).join('');
        bindPosterEvents(becauseRow);
    } else {
        document.getElementById('becauseTitle').textContent = '🎥 Critics\u2019 Favourites';
        document.getElementById('becauseSubtitle').textContent = 'Acclaimed films on Prime Video NL';
        const criticsItems = [...CATALOG]
            .filter(t => !usedIds.has(t.id))
            .sort((a, b) => (b.interest_score || 0) - (a.interest_score || 0))
            .slice(0, 24);
        criticsItems.forEach(t => usedIds.add(t.id));
        becauseRow.innerHTML = criticsItems.map(t => buildPosterCard(t)).join('');
        bindPosterEvents(becauseRow);
    }
    becauseSection.style.display = '';

    // ── Row 3: Hidden Gems ───────────────────────────────────
    const gems = [...CATALOG]
        .filter(t => (t.interest_score || 0) >= 55 && (t.popularity || 0) < 40)
        .filter(t => !usedIds.has(t.id))
        .sort((a, b) => (b.interest_score || 0) - (a.interest_score || 0))
        .slice(0, 24);
    const gemsRow = document.getElementById('hiddenGemsRow');
    if (gems.length) {
        gemsRow.innerHTML = gems.map(t => buildPosterCard(t)).join('');
        bindPosterEvents(gemsRow);
    } else {
        document.getElementById('hiddenGemsSection').style.display = 'none';
    }

    // ── Row 4: On MUBI ───────────────────────────────────────
    const mubiItems = [...CATALOG]
        .filter(t => (t.providers || []).includes('mubi'))
        .filter(t => !usedIds.has(t.id))
        .sort((a, b) => TasteEngine.computeAffinity(b, b.interest_score) - TasteEngine.computeAffinity(a, a.interest_score))
        .slice(0, 24);
    const mubiSection = document.getElementById('mubiSection');
    const mubiRow = document.getElementById('mubiRow');
    if (mubiItems.length) {
        mubiItems.forEach(t => usedIds.add(t.id));
        mubiRow.innerHTML = mubiItems.map(t => buildPosterCard(t)).join('');
        bindPosterEvents(mubiRow);
        const mubiTotal = CATALOG.filter(t => (t.providers || []).includes('mubi')).length;
        document.getElementById('mubiSubtitle').textContent =
            `${mubiTotal} curated titles · Arthouse & international cinema`;
        mubiSection.style.display = '';
    } else {
        mubiSection.style.display = 'none';
    }
}

// ── Catalog Grid ──────────────────────────────────────────────
function getFilteredCatalog() {
    let items = [...CATALOG];

    // Type filter
    if (state.typeFilter !== 'all') {
        items = items.filter(t => t.type === state.typeFilter);
    }

    // Genre filter — fuzzy: 'Action' matches 'Action' AND 'Action & Adventure'
    if (state.genreFilter) {
        const gf = state.genreFilter.toLowerCase();
        items = items.filter(t =>
            (t.genres || []).some(g => g.toLowerCase().includes(gf) || gf.includes(g.toLowerCase()))
        );
    }

    // Provider filter
    if (state.providerFilter) {
        items = items.filter(t => (t.providers || ['prime']).includes(state.providerFilter));
    }

    // Special filter: only watchlist remains
    if (state.specialFilter === 'watchlist') {
        items = items.filter(t => WATCHLIST.has(t.id));
    }

    // Search
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        items = items.filter(t => {
            const haystack = [
                t.title, t.director,
                ...(t.cast || []),
                ...(t.genres || []),
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(q);
        });
    }

    // Sort
    switch (state.sortBy) {
        case 'popularity':
            items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
            break;
        case 'foryou':
            // Taste Engine: personalized sort
            items.sort((a, b) => {
                const affinityA = TasteEngine.computeAffinity(a, a.interest_score);
                const affinityB = TasteEngine.computeAffinity(b, b.interest_score);
                return affinityB - affinityA;
            });
            break;
        case 'rating':
            items.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            break;
        case 'newest':
            items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            break;
        case 'az':
            items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
            break;
    }

    return items;
}

function renderCatalogGrid() {
    const grid = document.getElementById('catalogGrid');
    const filtered = getFilteredCatalog();
    const end = (state.gridPage + 1) * state.gridPageSize;
    const visible = filtered.slice(0, end);

    // Apply view mode class
    grid.classList.toggle('list-view', state.viewMode === 'list');

    // Update title
    const count = filtered.length;
    const label = state.searchQuery ? `Search Results (${count})` :
                  state.specialFilter === 'watchlist' ? `⭐ Watchlist (${count})` :
                  `Full Catalog (${count})`;
    document.getElementById('catalogTitle').textContent = label;

    if (!visible.length) {
        grid.innerHTML = '<div class="no-results"><div class="no-results-icon">🔍</div>No titles match your filters.</div>';
        document.getElementById('loadMoreBtn').style.display = 'none';
        return;
    }

    // Render both card types — CSS handles visibility based on view mode
    grid.innerHTML = visible.map(t => buildPosterCard(t) + buildListItem(t)).join('');
    bindPosterEvents(grid);
    bindListEvents(grid);

    // Load more button
    const btn = document.getElementById('loadMoreBtn');
    if (end >= filtered.length) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'inline-block';
        btn.textContent = `Load More (${filtered.length - end} remaining)`;
    }
}

// ── Poster Card Builder ───────────────────────────────────────
function buildPosterCard(t) {
    const isSaved = WATCHLIST.has(t.id);
    const rating = t.rating ? `<span class="rating-star">★</span> ${t.rating}` : '';
    const year = t.date ? t.date.substring(0, 4) : '';
    const meta = [rating, year].filter(Boolean).join(' · ');

    let badge = '';
    const provs = t.providers || ['prime'];
    if (provs.includes('mubi') && provs.includes('prime')) {
        badge = '<span class="poster-badge badge-both">▶ Ⓜ</span>';
    } else if (provs.includes('mubi')) {
        badge = '<span class="poster-badge badge-mubi">Ⓜ</span>';
    } else if (t.trending) {
        badge = '<span class="poster-badge badge-trending">🔥</span>';
    } else if (t.new) {
        badge = '<span class="poster-badge badge-new">NEW</span>';
    }

    const img = t.poster
        ? `<img class="poster-img" src="${t.poster}" alt="${escAttr(t.title)}" loading="lazy">`
        : `<div class="poster-no-image">${t.type === 'movie' ? '🎬' : '📺'}</div>`;

    return `
        <div class="poster-card" data-id="${t.id}">
            ${badge}
            <button class="poster-watchlist ${isSaved ? 'saved' : ''}" data-wl-id="${t.id}" title="Add to watchlist">
                ${isSaved ? '★' : '☆'}
            </button>
            ${img}
            <div class="poster-info">
                <div class="poster-title">${escHtml(t.title)}</div>
                <div class="poster-meta">${meta}</div>
            </div>
        </div>
    `;
}

// ── List Item Builder ─────────────────────────────────────────
function buildListItem(t) {
    const isSaved = WATCHLIST.has(t.id);
    const year = t.date ? t.date.substring(0, 4) : '';
    const genres = (t.genres || []).slice(0, 2).join(', ');
    const runtime = t.type === 'movie' && t.runtime ? `${Math.floor(t.runtime/60)}h${(t.runtime%60).toString().padStart(2,'0')}` : '';
    const seasons = t.type === 'tv' && t.seasons ? `S${t.seasons}` : '';

    let badges = '';
    if (t.trending) badges += '<span class="list-badge list-badge-trending">🔥</span>';
    if (t.new) badges += '<span class="list-badge list-badge-new">NEW</span>';
    const provs = t.providers || ['prime'];
    if (provs.includes('mubi')) badges += '<span class="list-badge list-badge-mubi">Ⓜ</span>';
    badges += t.type === 'movie'
        ? '<span class="list-badge list-badge-movie">Film</span>'
        : '<span class="list-badge list-badge-tv">Series</span>';

    const meta = [year, genres, runtime, seasons].filter(Boolean).join(' · ');
    const overview = (t.overview || '').substring(0, 150);

    const posterHtml = t.poster
        ? `<img class="list-item-poster" src="${t.poster.replace('/w500/', '/w92/')}" alt="${escAttr(t.title)}" loading="lazy">`
        : `<div class="list-item-poster-placeholder">${t.type === 'movie' ? '🎬' : '📺'}</div>`;

    return `
        <div class="list-item" data-id="${t.id}">
            ${posterHtml}
            <div class="list-item-body">
                <div class="list-item-title-row">
                    <span class="list-item-title">${escHtml(t.title)}</span>
                    <div class="list-item-badges">${badges}</div>
                </div>
                <div class="list-item-meta">${meta}</div>
                <div class="list-item-overview">${escHtml(overview)}</div>
            </div>
            <div class="list-item-right">
                ${t.rating ? `<div class="list-item-rating">★ ${t.rating}</div>` : ''}
                <button class="list-item-watchlist ${isSaved ? 'saved' : ''}" data-wl-id="${t.id}">
                    ${isSaved ? '★' : '☆'}
                </button>
            </div>
        </div>
    `;
}

// ── Modal ─────────────────────────────────────────────────────
function openModal(t) {
    const overlay = document.getElementById('modalOverlay');
    const backdrop = document.getElementById('modalBackdrop');
    const content = document.getElementById('modalContent');

    backdrop.style.backgroundImage = t.backdrop ? `url('${t.backdrop}')` : 'none';

    const genres = (t.genres || []).map(g => `<span class="modal-genre-tag">${escHtml(g)}</span>`).join('');
    const rating = t.rating ? `<span class="modal-rating">★ ${t.rating}</span>` : '';
    const year = t.date ? t.date.substring(0, 4) : '';
    const runtime = t.type === 'movie' && t.runtime ? `${Math.floor(t.runtime/60)}h${(t.runtime%60).toString().padStart(2,'0')}` : '';
    const seasons = t.type === 'tv' && t.seasons ? `${t.seasons} season${t.seasons > 1 ? 's' : ''}` : '';
    const isSaved = WATCHLIST.has(t.id);

    let metaParts = [rating, year, runtime, seasons, t.type === 'movie' ? 'Film' : 'TV Series'].filter(Boolean);

    let castHtml = '';
    if (t.cast && t.cast.length) {
        castHtml = `
            <div class="modal-cast">
                <div class="modal-cast-label">${t.director ? 'Director' : 'Cast'}</div>
                <div class="modal-cast-names">${t.director ? escHtml(t.director) + ' · ' : ''}${t.cast.map(escHtml).join(', ')}</div>
            </div>
        `;
    }

    let trailerHtml = '';
    if (t.trailer_key) {
        trailerHtml = `
            <div class="modal-trailer">
                <iframe src="https://www.youtube.com/embed/${t.trailer_key}" allowfullscreen></iframe>
            </div>
        `;
    }

    // ── n/10 Rating Widget ─────────────────────────────────
    const currentRating = TasteEngine.getRating(t.id);
    const ratingLabels = {
        1: 'Awful', 2: 'Bad', 3: 'Poor', 4: 'Meh',
        5: 'Okay', 6: 'Decent', 7: 'Good',
        8: 'Great', 9: 'Excellent', 10: 'Masterpiece'
    };
    const ratingDots = Array.from({length: 10}, (_, i) => {
        const score = i + 1;
        const isActive = currentRating && score <= currentRating;
        const isSelected = currentRating && score === currentRating;
        return `<button class="modal-rating-dot ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}" 
                        data-score="${score}" title="${score}/10">${score}</button>`;
    }).join('');

    const scoreDisplay = currentRating 
        ? `${currentRating}/10<span class="score-label">${ratingLabels[currentRating]}</span>`
        : `<span style="font-size:12px;color:var(--text-muted)">Rate</span>`;

    const ratingWidgetHtml = `
        <div class="modal-rating-widget" id="modalRatingWidget">
            <div class="modal-rating-label">Your Rating</div>
            <div class="modal-rating-dots" id="modalRatingDots">
                ${ratingDots}
            </div>
            <div class="modal-rating-score" id="modalRatingScore">${scoreDisplay}</div>
        </div>
    `;

    content.innerHTML = `
        <h2 class="modal-title">${escHtml(t.title)}</h2>
        <div class="modal-meta">${metaParts.join(' · ')}</div>
        <div>${genres}</div>
        <p class="modal-overview">${escHtml(t.overview || 'No description available.')}</p>
        ${castHtml}
        <div class="modal-actions">
            <button class="modal-watchlist-btn ${isSaved ? 'saved' : ''}" data-wl-id="${t.id}">
                ${isSaved ? '★ In Watchlist' : '☆ Add to Watchlist'}
            </button>
        </div>
        ${ratingWidgetHtml}
        ${trailerHtml}
    `;

    // Bind modal watchlist button
    content.querySelector('.modal-watchlist-btn').addEventListener('click', (e) => {
        toggleWatchlist(t.id);
        const btn = e.currentTarget;
        const saved = WATCHLIST.has(t.id);
        btn.classList.toggle('saved', saved);
        btn.innerHTML = saved ? '★ In Watchlist' : '☆ Add to Watchlist';
        // Behavioral signal
        TasteEngine.recordSignal(saved ? 'add_watchlist' : 'remove_watchlist', t);
        updateTasteIndicator();
    });

    // Bind n/10 rating dots
    content.querySelectorAll('.modal-rating-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            const score = parseInt(e.currentTarget.dataset.score);
            TasteEngine.processRating(t.id, score, t);
            // Update visual
            content.querySelectorAll('.modal-rating-dot').forEach(d => {
                const s = parseInt(d.dataset.score);
                d.classList.toggle('active', s <= score);
                d.classList.toggle('selected', s === score);
            });
            const scoreEl = document.getElementById('modalRatingScore');
            scoreEl.innerHTML = `${score}/10<span class="score-label">${ratingLabels[score]}</span>`;
            updateTasteIndicator();
        });

        // Hover preview
        dot.addEventListener('mouseenter', (e) => {
            const previewScore = parseInt(e.currentTarget.dataset.score);
            content.querySelectorAll('.modal-rating-dot').forEach(d => {
                const s = parseInt(d.dataset.score);
                d.classList.toggle('active', s <= previewScore);
            });
            const scoreEl = document.getElementById('modalRatingScore');
            scoreEl.innerHTML = `${previewScore}/10<span class="score-label">${ratingLabels[previewScore]}</span>`;
        });

        dot.addEventListener('mouseleave', () => {
            const actual = TasteEngine.getRating(t.id);
            content.querySelectorAll('.modal-rating-dot').forEach(d => {
                const s = parseInt(d.dataset.score);
                d.classList.toggle('active', actual && s <= actual);
                d.classList.toggle('selected', actual && s === actual);
            });
            const scoreEl = document.getElementById('modalRatingScore');
            if (actual) {
                scoreEl.innerHTML = `${actual}/10<span class="score-label">${ratingLabels[actual]}</span>`;
            } else {
                scoreEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">Rate</span>`;
            }
        });
    });

    // Behavioral signal: opened detail
    TasteEngine.recordSignal('click_poster', t);

    // Track trailer plays
    if (t.trailer_key) {
        const iframe = content.querySelector('.modal-trailer iframe');
        if (iframe) {
            iframe.addEventListener('load', () => {
                TasteEngine.recordSignal('play_trailer', t);
            });
        }
    }

    // Long view tracking (>10s)
    const modalOpenTime = Date.now();
    const longViewCheck = setInterval(() => {
        if (!document.getElementById('modalOverlay').classList.contains('open')) {
            clearInterval(longViewCheck);
            return;
        }
        if (Date.now() - modalOpenTime > 10000) {
            TasteEngine.recordSignal('long_view', t);
            clearInterval(longViewCheck);
        }
    }, 5000);

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    document.body.style.overflow = '';
    // Stop any playing trailer
    const iframe = document.querySelector('.modal-trailer iframe');
    if (iframe) iframe.src = '';
}

// ── Watchlist ─────────────────────────────────────────────────
function toggleWatchlist(id) {
    if (WATCHLIST.has(id)) {
        WATCHLIST.delete(id);
    } else {
        WATCHLIST.add(id);
    }
    localStorage.setItem('pvnl_watchlist', JSON.stringify([...WATCHLIST]));
}

// ── Events ────────────────────────────────────────────────────
function bindEvents() {
    // Type + special filter buttons
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;

            if (filter === 'all') {
                state.typeFilter = 'all';
                state.specialFilter = null;
                document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            } else if (['movie', 'tv'].includes(filter)) {
                state.typeFilter = filter;
                // Keep special filter active, deactivate other type buttons
                document.querySelectorAll('[data-filter="all"],[data-filter="movie"],[data-filter="tv"]')
                    .forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            } else if (filter === 'watchlist') {
                // Toggle watchlist filter
                if (state.specialFilter === filter) {
                    state.specialFilter = null;
                    btn.classList.remove('active');
                } else {
                    state.specialFilter = filter;
                    document.querySelectorAll('[data-filter="watchlist"]')
                        .forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                }
            }

            state.gridPage = 0;
            renderCatalogGrid();
        });
    });

    // Provider filter buttons
    document.querySelectorAll('[data-provider]').forEach(btn => {
        btn.addEventListener('click', () => {
            const prov = btn.dataset.provider;
            state.providerFilter = prov === 'all' ? null : prov;
            state.gridPage = 0;
            document.querySelectorAll('[data-provider]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderCatalogGrid();
        });
    });

    // Sort dropdown
    document.querySelectorAll('#sortMenu .dropdown-item').forEach(btn => {
        btn.addEventListener('click', () => {
            state.sortBy = btn.dataset.sort;
            state.gridPage = 0;
            document.querySelectorAll('#sortMenu .dropdown-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const labels = { popularity: 'Popular', foryou: '✨ For You', rating: 'Top Rated', newest: 'Newest', az: 'A → Z' };
            document.getElementById('sortBtn').textContent = `Sort: ${labels[state.sortBy]} ▾`;
            document.getElementById('sortDropdown').classList.remove('open');
            renderCatalogGrid();
        });
    });

    // Dropdown toggles
    document.querySelectorAll('.dropdown-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = btn.closest('.dropdown');
            // Close others
            document.querySelectorAll('.dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.toggle('open');
        });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
        document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
    });

    // Search
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.searchQuery = e.target.value.trim();
            state.gridPage = 0;
            renderCatalogGrid();
        }, 300);
    });

    // Load more
    document.getElementById('loadMoreBtn').addEventListener('click', () => {
        state.gridPage++;
        renderCatalogGrid();
    });

    // Modal close
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // View toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.viewMode = btn.dataset.view;
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderCatalogGrid();
        });
    });
}

function bindPosterEvents(container) {
    // Click card → open modal
    container.querySelectorAll('.poster-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.poster-watchlist')) return;
            const id = parseInt(card.dataset.id);
            const title = CATALOG.find(t => t.id === id);
            if (title) openModal(title);
        });
    });

    // Watchlist buttons
    container.querySelectorAll('.poster-watchlist').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.wlId);
            toggleWatchlist(id);
            const saved = WATCHLIST.has(id);
            btn.classList.toggle('saved', saved);
            btn.innerHTML = saved ? '★' : '☆';
        });
    });
}

function bindListEvents(container) {
    // Click list item → open modal
    container.querySelectorAll('.list-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.list-item-watchlist')) return;
            const id = parseInt(item.dataset.id);
            const title = CATALOG.find(t => t.id === id);
            if (title) openModal(title);
        });
    });

    // List item watchlist buttons
    container.querySelectorAll('.list-item-watchlist').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.wlId);
            toggleWatchlist(id);
            const saved = WATCHLIST.has(id);
            btn.classList.toggle('saved', saved);
            btn.innerHTML = saved ? '★' : '☆';
        });
    });
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Taste Indicator ──────────────────────────────────────────
function updateTasteIndicator() {
    const indicator = document.getElementById('tasteIndicator');
    const label = document.getElementById('tasteIndicatorLabel');
    if (!indicator) return;

    const taste = TasteEngine.getTasteVector();
    const ratings = taste.totalRatings || 0;

    if (ratings === 0 && !TasteEngine.isOnboardingDone()) {
        label.textContent = 'Set Up Profile';
        indicator.onclick = () => OnboardingQuiz.show();
    } else {
        // Find top signals
        const topSignals = Object.entries(taste.signals)
            .filter(([_, v]) => v > 0.1)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 2)
            .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));

        if (topSignals.length) {
            label.textContent = topSignals.join(' · ');
        } else {
            label.textContent = `${ratings} rated`;
        }

        indicator.onclick = () => {
            // Toggle For You sort
            state.sortBy = state.sortBy === 'foryou' ? 'popularity' : 'foryou';
            state.gridPage = 0;
            const labels = { popularity: 'Popular', foryou: '✨ For You', rating: 'Top Rated', newest: 'Newest', az: 'A → Z' };
            document.getElementById('sortBtn').textContent = `Sort: ${labels[state.sortBy]} ▾`;
            document.querySelectorAll('#sortMenu .dropdown-item').forEach(b => {
                b.classList.toggle('active', b.dataset.sort === state.sortBy);
            });
            renderCatalogGrid();
            OnboardingQuiz.showToast(
                state.sortBy === 'foryou' ? 'Sorted by your taste' : 'Sorted by popularity'
            );
        };
    }
}
