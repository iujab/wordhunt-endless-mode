// Renders a histogram of all players' best scores on the timed-mode end screen,
// marking where the run the player just finished lands. Exposes
// window.renderScoreHistogram(runScore), called from script.js's endGame().
(function () {
    const BUCKET_TARGET = 18;   // approximate number of bars
    const MIN_PLAYERS = 5;      // need at least this many ranked players to bother

    // Round a raw bucket width up to a clean multiple of 100 (scores are multiples of 100).
    function roundWidth(raw) {
        return Math.max(100, Math.ceil(raw / 100) * 100);
    }

    // Pull every user's highScore. Returns an array of scores > 0, or null if Firebase is unavailable.
    async function fetchHighScores() {
        const fb = window.firebase;
        if (!fb || !fb.db || !fb.collection || !fb.getDocs) return null;

        const snap = await fb.getDocs(fb.collection(fb.db, 'users'));
        const scores = [];
        snap.forEach((docSnap) => {
            const hs = docSnap.data().highScore;
            // Exclude users who have never completed a ranked run.
            if (typeof hs === 'number' && hs > 0) scores.push(hs);
        });
        return scores;
    }

    // Bin scores into buckets and work out where this run lands.
    function buildHistogram(scores, runScore) {
        const maxScore = Math.max(runScore, ...scores);
        const width = roundWidth(maxScore / BUCKET_TARGET);
        const bucketCount = Math.floor(maxScore / width) + 1;

        const buckets = new Array(bucketCount).fill(0);
        scores.forEach((s) => {
            const i = Math.min(bucketCount - 1, Math.floor(s / width));
            buckets[i]++;
        });

        const runBucket = Math.min(bucketCount - 1, Math.floor(runScore / width));
        const beaten = scores.filter((s) => s <= runScore).length;
        const percentile = Math.round((beaten / scores.length) * 100);

        return { buckets, width, runBucket, percentile, total: scores.length };
    }

    function render(container, data, runScore) {
        const { buckets, width, runBucket, percentile, total } = data;
        const maxCount = Math.max(...buckets, 1);

        const barsHtml = buckets.map((count, i) => {
            const heightPct = Math.round((count / maxCount) * 100);
            const isRun = i === runBucket;
            const lo = (i * width).toLocaleString();
            const hi = ((i + 1) * width - 1).toLocaleString();
            return `
                <div class="wh-hist-col" title="${lo}–${hi}: ${count} player${count === 1 ? '' : 's'}">
                    <div class="wh-hist-bar${isRun ? ' wh-hist-bar--you' : ''}" style="height:${heightPct}%"></div>
                </div>`;
        }).join('');

        container.innerHTML = `
            <p class="text-slate-800 font-semibold text-center mb-1">
                You scored ${runScore.toLocaleString()} &mdash; better than ${percentile}% of players
            </p>
            <div class="wh-hist">${barsHtml}</div>
            <p class="text-slate-500 text-xs text-center mt-1">Best scores of ${total.toLocaleString()} ranked players</p>
        `;
        container.classList.remove('hidden');
    }

    window.renderScoreHistogram = async function (runScore) {
        const container = document.getElementById('score-histogram');
        if (!container) return;

        container.classList.remove('hidden');
        container.innerHTML = '<p class="text-slate-500 text-center">Loading score distribution…</p>';

        try {
            const scores = await fetchHighScores();
            if (!scores || scores.length < MIN_PLAYERS) {
                container.innerHTML = '<p class="text-slate-500 text-center">Not enough data yet to compare.</p>';
                return;
            }
            render(container, buildHistogram(scores, runScore), runScore);
        } catch (err) {
            console.error('Histogram error:', err);
            // Never let a failed histogram break the end screen.
            container.classList.add('hidden');
        }
    };
})();
