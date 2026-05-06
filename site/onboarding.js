/* ── Onboarding Quiz — "Rate Films You Know" ─────────────────── */
'use strict';

const OnboardingQuiz = (() => {
    let quizOverlay = null;
    let currentRatings = {};  // { filmId: score }
    let hasBeenTriggered = false;

    // ── Should we show the quiz? ──────────────────────────────
    function shouldShow() {
        return !TasteEngine.isOnboardingDone() && !hasBeenTriggered;
    }

    // ── Trigger after 30s of browsing ─────────────────────────
    function scheduleShow() {
        if (!shouldShow()) return;
        setTimeout(() => {
            if (shouldShow()) show();
        }, 30000); // 30 seconds
    }

    // ── Build and show the quiz overlay ───────────────────────
    function show() {
        if (hasBeenTriggered) return;
        hasBeenTriggered = true;

        quizOverlay = document.createElement('div');
        quizOverlay.id = 'onboardingOverlay';
        quizOverlay.className = 'onboarding-overlay';
        quizOverlay.innerHTML = buildQuizHTML();
        document.body.appendChild(quizOverlay);

        // Trigger animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                quizOverlay.classList.add('visible');
            });
        });

        bindQuizEvents();
        updateSubmitButton();
    }

    // ── Quiz HTML ─────────────────────────────────────────────
    function buildQuizHTML() {
        const filmCards = TasteEngine.SEED_FILMS.map(film => `
            <div class="quiz-film" data-film-id="${film.id}">
                <div class="quiz-film-poster-wrap">
                    <img class="quiz-film-poster" 
                         src="${film.poster}" 
                         alt="${film.title}"
                         loading="lazy">
                    <div class="quiz-film-skip" data-film-id="${film.id}">
                        Haven't seen it
                    </div>
                </div>
                <div class="quiz-film-info">
                    <div class="quiz-film-title">${film.title}</div>
                    <div class="quiz-film-year">${film.year}</div>
                </div>
                <div class="quiz-rating-widget" data-film-id="${film.id}">
                    <div class="quiz-rating-track">
                        <div class="quiz-rating-fill" data-film-id="${film.id}"></div>
                    </div>
                    <div class="quiz-rating-dots">
                        ${Array.from({length: 10}, (_, i) => `
                            <button class="quiz-rating-dot" 
                                    data-film-id="${film.id}" 
                                    data-score="${i + 1}"
                                    title="${i + 1}/10">
                            </button>
                        `).join('')}
                    </div>
                    <div class="quiz-rating-label" data-film-id="${film.id}"></div>
                </div>
            </div>
        `).join('');

        return `
            <div class="onboarding-panel">
                <button class="onboarding-dismiss" id="quizDismiss" title="Skip for now">✕</button>
                <div class="onboarding-header">
                    <div class="onboarding-icon">🎬</div>
                    <h2 class="onboarding-title">Help us find films you'll love</h2>
                    <p class="onboarding-subtitle">Rate a few movies you know — we'll personalize your catalog</p>
                </div>
                <div class="quiz-films-grid" id="quizFilmsGrid">
                    ${filmCards}
                </div>
                <div class="onboarding-footer">
                    <div class="quiz-progress" id="quizProgress">
                        <div class="quiz-progress-bar" id="quizProgressBar"></div>
                    </div>
                    <div class="quiz-counter" id="quizCounter">Rate at least 5 to unlock recommendations</div>
                    <button class="quiz-submit-btn" id="quizSubmitBtn" disabled>
                        Show Me What to Watch →
                    </button>
                </div>
            </div>
        `;
    }

    // ── Rating labels ─────────────────────────────────────────
    const RATING_LABELS = {
        1: 'Awful', 2: 'Bad', 3: 'Poor', 4: 'Meh',
        5: 'Okay', 6: 'Decent', 7: 'Good',
        8: 'Great', 9: 'Excellent', 10: 'Masterpiece'
    };

    // ── Bind events ───────────────────────────────────────────
    function bindQuizEvents() {
        // Rating dots
        quizOverlay.querySelectorAll('.quiz-rating-dot').forEach(dot => {
            dot.addEventListener('click', (e) => {
                const filmId = parseInt(e.target.dataset.filmId);
                const score = parseInt(e.target.dataset.score);
                setRating(filmId, score);
            });

            // Hover preview
            dot.addEventListener('mouseenter', (e) => {
                const filmId = parseInt(e.target.dataset.filmId);
                const score = parseInt(e.target.dataset.score);
                previewRating(filmId, score);
            });

            dot.addEventListener('mouseleave', (e) => {
                const filmId = parseInt(e.target.dataset.filmId);
                restoreRating(filmId);
            });
        });

        // Skip buttons
        quizOverlay.querySelectorAll('.quiz-film-skip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filmId = parseInt(e.target.dataset.filmId);
                skipFilm(filmId);
            });
        });

        // Submit
        document.getElementById('quizSubmitBtn').addEventListener('click', submitQuiz);

        // Dismiss
        document.getElementById('quizDismiss').addEventListener('click', dismissQuiz);
    }

    // ── Set rating for a film ─────────────────────────────────
    function setRating(filmId, score) {
        currentRatings[filmId] = score;

        const filmEl = quizOverlay.querySelector(`.quiz-film[data-film-id="${filmId}"]`);
        filmEl.classList.add('rated');
        filmEl.classList.remove('skipped');

        // Update visual
        updateRatingVisual(filmId, score, true);

        // Update label
        const label = quizOverlay.querySelector(`.quiz-rating-label[data-film-id="${filmId}"]`);
        label.textContent = `${score}/10 · ${RATING_LABELS[score]}`;
        label.classList.add('visible');

        updateSubmitButton();
    }

    function previewRating(filmId, score) {
        updateRatingVisual(filmId, score, false);
        const label = quizOverlay.querySelector(`.quiz-rating-label[data-film-id="${filmId}"]`);
        label.textContent = `${score}/10 · ${RATING_LABELS[score]}`;
        label.classList.add('visible');
    }

    function restoreRating(filmId) {
        const actual = currentRatings[filmId];
        if (actual) {
            updateRatingVisual(filmId, actual, true);
            const label = quizOverlay.querySelector(`.quiz-rating-label[data-film-id="${filmId}"]`);
            label.textContent = `${actual}/10 · ${RATING_LABELS[actual]}`;
        } else {
            updateRatingVisual(filmId, 0, false);
            const label = quizOverlay.querySelector(`.quiz-rating-label[data-film-id="${filmId}"]`);
            label.textContent = '';
            label.classList.remove('visible');
        }
    }

    function updateRatingVisual(filmId, score, isCommitted) {
        // Update dots
        quizOverlay.querySelectorAll(`.quiz-rating-dot[data-film-id="${filmId}"]`).forEach(dot => {
            const dotScore = parseInt(dot.dataset.score);
            dot.classList.toggle('active', dotScore <= score);
            dot.classList.toggle('committed', dotScore <= score && isCommitted);
        });

        // Update fill bar
        const fill = quizOverlay.querySelector(`.quiz-rating-fill[data-film-id="${filmId}"]`);
        if (fill) {
            fill.style.width = `${(score / 10) * 100}%`;
            // Color gradient: red(1) → yellow(5) → green(10)
            if (score <= 4) {
                fill.style.background = `linear-gradient(90deg, #ff4444, #ff8844)`;
            } else if (score <= 6) {
                fill.style.background = `linear-gradient(90deg, #ff8844, #ffcc44)`;
            } else {
                fill.style.background = `linear-gradient(90deg, #44cc88, #00d4aa)`;
            }
        }
    }

    function skipFilm(filmId) {
        delete currentRatings[filmId];
        const filmEl = quizOverlay.querySelector(`.quiz-film[data-film-id="${filmId}"]`);
        filmEl.classList.add('skipped');
        filmEl.classList.remove('rated');

        // Reset visual
        updateRatingVisual(filmId, 0, false);
        const label = quizOverlay.querySelector(`.quiz-rating-label[data-film-id="${filmId}"]`);
        label.textContent = 'Skipped';
        label.classList.add('visible');
        label.style.color = 'var(--text-muted)';

        updateSubmitButton();
    }

    // ── Update submit button state ────────────────────────────
    function updateSubmitButton() {
        const ratedCount = Object.keys(currentRatings).length;
        const minRequired = 5;
        const btn = document.getElementById('quizSubmitBtn');
        const counter = document.getElementById('quizCounter');
        const progressBar = document.getElementById('quizProgressBar');

        btn.disabled = ratedCount < minRequired;

        if (ratedCount >= minRequired) {
            counter.textContent = `${ratedCount} films rated — ready to go!`;
            counter.style.color = 'var(--accent-primary)';
        } else {
            counter.textContent = `Rate ${minRequired - ratedCount} more to unlock recommendations`;
            counter.style.color = '';
        }

        // Progress bar: 0-12 films
        const progress = Math.min(100, (ratedCount / TasteEngine.SEED_FILMS.length) * 100);
        progressBar.style.width = `${progress}%`;
    }

    // ── Submit quiz ───────────────────────────────────────────
    function submitQuiz() {
        // Process all ratings through taste engine
        Object.entries(currentRatings).forEach(([filmIdStr, score]) => {
            const filmId = parseInt(filmIdStr);
            const seedFilm = TasteEngine.SEED_FILMS.find(f => f.id === filmId);
            if (seedFilm) {
                TasteEngine.processQuizRating(seedFilm, score);
            }
        });

        TasteEngine.markOnboardingDone();

        // Animate out
        quizOverlay.classList.remove('visible');
        setTimeout(() => {
            quizOverlay.remove();
            // Re-sort catalog with new taste data
            if (typeof renderCatalogGrid === 'function') {
                renderCatalogGrid();
            }
            // Show confirmation toast
            showToast(`Profile created from ${Object.keys(currentRatings).length} ratings`);
        }, 400);
    }

    // ── Dismiss ───────────────────────────────────────────────
    function dismissQuiz() {
        quizOverlay.classList.remove('visible');
        setTimeout(() => {
            quizOverlay.remove();
        }, 400);
    }

    // ── Toast notification ────────────────────────────────────
    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'taste-toast';
        toast.innerHTML = `<span class="taste-toast-icon">✨</span> ${message}`;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => toast.classList.add('visible'));
        });
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }

    return {
        shouldShow,
        scheduleShow,
        show,
        showToast,
    };
})();
