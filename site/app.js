/* ── Prime Video NL — Client App ─────────────────────────────── */
'use strict';

let CATALOG = [];
let GENRES = [];
let WATCHLIST = new Set(JSON.parse(localStorage.getItem('pvnl_watchlist') || '[]'));

// ── State ─────────────────────────────────────────────────────
let state = {
    typeFilter: 'all',      // all | movie | tv
    genreFilter: null,       // null or genre string
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
            renderTrendingRow();
            renderNewRow();
            renderCatalogGrid();
            bindEvents();
        })
        .catch(err => {
            console.error('Failed to load catalog:', err);
            document.getElementById('catalogGrid').innerHTML =
                '<div class="no-results"><div class="no-results-icon">📡</div>Failed to load catalog data.</div>';
        });
});

// ── Stats ─────────────────────────────────────────────────────
function renderStats(stats) {
    if (!stats) return;
    document.getElementById('statTotal').innerHTML = `<strong>${stats.total}</strong> titles`;
    document.getElementById('statMovies').innerHTML = `<strong>${stats.movies}</strong> movies`;
    document.getElementById('statShows').innerHTML = `<strong>${stats.tv_shows}</strong> series`;
    document.getElementById('statTrending').innerHTML = `🔥 <strong>${stats.trending}</strong> trending`;
    document.getElementById('statNew').innerHTML = `🆕 <strong>${stats.new_this_week}</strong> new this week`;
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
    const trending = CATALOG.filter(t => t.trending && t.backdrop).slice(0, 6);
    if (!trending.length) {
        document.getElementById('heroSection').style.display = 'none';
        return;
    }

    const carousel = document.getElementById('heroCarousel');
    const dots = document.getElementById('heroDots');
    carousel.innerHTML = '';
    dots.innerHTML = '';

    trending.forEach((t, i) => {
        // Slide
        const slide = document.createElement('div');
        slide.className = 'hero-slide';
        const genres = (t.genres || []).slice(0, 2).join(', ');
        const year = t.date ? t.date.substring(0, 4) : '';
        const rating = t.rating ? `<span class="rating-star">★</span> ${t.rating}` : '';
        const meta = [rating, year, genres, t.type === 'movie' ? '🎬 Film' : '📺 Series'].filter(Boolean).join(' · ');

        slide.innerHTML = `
            <div class="hero-slide-bg" style="background-image:url('${t.backdrop}')"></div>
            <div class="hero-slide-content">
                <div class="hero-badge">${t.trending ? '🔥 Trending' : '🆕 New'}</div>
                <h2 class="hero-title">${escHtml(t.title)}</h2>
                <div class="hero-meta">${meta}</div>
                <p class="hero-overview">${escHtml(t.overview || '')}</p>
            </div>
        `;
        slide.addEventListener('click', () => openModal(t));
        carousel.appendChild(slide);

        // Dot
        const dot = document.createElement('div');
        dot.className = 'hero-dot' + (i === 0 ? ' active' : '');
        dot.addEventListener('click', () => goToHeroSlide(i));
        dots.appendChild(dot);
    });

    heroInterval = setInterval(() => {
        goToHeroSlide((heroIndex + 1) % trending.length);
    }, 6000);
}

function goToHeroSlide(idx) {
    heroIndex = idx;
    document.getElementById('heroCarousel').style.transform = `translateX(-${idx * 100}%)`;
    document.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
}

// ── Scroll Rows ───────────────────────────────────────────────
function renderTrendingRow() {
    const items = CATALOG.filter(t => t.trending).slice(0, 20);
    const row = document.getElementById('trendingRow');
    if (!items.length) {
        document.getElementById('trendingSection').style.display = 'none';
        return;
    }
    row.innerHTML = items.map(t => buildPosterCard(t)).join('');
    bindPosterEvents(row);
}

function renderNewRow() {
    const items = CATALOG.filter(t => t.new).slice(0, 20);
    const row = document.getElementById('newRow');
    if (!items.length) {
        document.getElementById('newSection').style.display = 'none';
        return;
    }
    row.innerHTML = items.map(t => buildPosterCard(t)).join('');
    bindPosterEvents(row);
}

// ── Catalog Grid ──────────────────────────────────────────────
function getFilteredCatalog() {
    let items = [...CATALOG];

    // Type filter
    if (state.typeFilter !== 'all') {
        items = items.filter(t => t.type === state.typeFilter);
    }

    // Genre filter
    if (state.genreFilter) {
        items = items.filter(t => (t.genres || []).includes(state.genreFilter));
    }

    // Special filter
    if (state.specialFilter === 'trending') {
        items = items.filter(t => t.trending);
    } else if (state.specialFilter === 'new') {
        items = items.filter(t => t.new);
    } else if (state.specialFilter === 'watchlist') {
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
    if (t.trending) badge = '<span class="poster-badge badge-trending">🔥</span>';
    else if (t.new) badge = '<span class="poster-badge badge-new">NEW</span>';

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
        ${trailerHtml}
    `;

    // Bind modal watchlist button
    content.querySelector('.modal-watchlist-btn').addEventListener('click', (e) => {
        toggleWatchlist(t.id);
        const btn = e.currentTarget;
        const saved = WATCHLIST.has(t.id);
        btn.classList.toggle('saved', saved);
        btn.innerHTML = saved ? '★ In Watchlist' : '☆ Add to Watchlist';
    });

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
    // Type filter buttons
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;

            if (['all', 'movie', 'tv'].includes(filter)) {
                state.typeFilter = filter;
                state.specialFilter = null;
                document.querySelectorAll('.filter-group:first-child .filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                // Deactivate special filters
                ['filterTrending', 'filterNew', 'filterWatchlist'].forEach(id => {
                    document.getElementById(id).classList.remove('active');
                });
            } else if (['trending', 'new', 'watchlist'].includes(filter)) {
                if (state.specialFilter === filter) {
                    state.specialFilter = null;
                    btn.classList.remove('active');
                } else {
                    state.specialFilter = filter;
                    ['filterTrending', 'filterNew', 'filterWatchlist'].forEach(id => {
                        document.getElementById(id).classList.remove('active');
                    });
                    btn.classList.add('active');
                }
            }

            state.gridPage = 0;
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
            const labels = { popularity: 'Popular', rating: 'Top Rated', newest: 'Newest', az: 'A → Z' };
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
