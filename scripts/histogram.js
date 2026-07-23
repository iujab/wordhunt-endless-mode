// Renders a histogram of all players' best scores on the timed-mode end screen,
// marking where the run the player just finished lands. Exposes
// window.renderScoreHistogram(runScore), called from script.js's endGame().
//
// Built from Firestore server-side count aggregations rather than downloading
// every user document: each count costs one read per 1,000 index entries and
// transfers no document data, so a render is ~20 tiny requests no matter how
// many users exist.
(function () {
    const BUCKET_TARGET = 18;   // approximate number of bars
    const MIN_PLAYERS = 5;      // need at least this many ranked players to bother

    // Round a raw bucket width up to a clean multiple of 100 (scores are multiples of 100).
    function roundWidth(raw) {
        return Math.max(100, Math.ceil(raw / 100) * 100);
    }

    // Returns window.firebase if it exposes everything we need, else null.
    function firebaseReady() {
        const fb = window.firebase;
        const needed = ['db', 'collection', 'query', 'where', 'orderBy', 'limit', 'getDocs', 'getCountFromServer'];
        return fb && needed.every((name) => fb[name]) ? fb : null;
    }

    // Server-side count of users matching the given where() constraints.
    async function countUsers(fb, constraints) {
        const q = fb.query(fb.collection(fb.db, 'users'), ...constraints);
        const snap = await fb.getCountFromServer(q);
        return snap.data().count;
    }

    // Count ranked users whose highScore falls in [lo, hi); hi === null means unbounded.
    function countRange(fb, lo, hi) {
        const constraints = [lo > 0 ? fb.where('highScore', '>=', lo) : fb.where('highScore', '>', 0)];
        if (hi !== null) constraints.push(fb.where('highScore', '<', hi));
        return countUsers(fb, constraints);
    }

    // Aggregate the distribution and work out where this run lands. Returns
    // null when there aren't enough ranked players.
    async function fetchHistogram(fb, runScore) {
        // Current top score (one document read) and ranked-player total (one count).
        const [topSnap, total] = await Promise.all([
            fb.getDocs(fb.query(fb.collection(fb.db, 'users'), fb.orderBy('highScore', 'desc'), fb.limit(1))),
            countRange(fb, 0, null)
        ]);
        if (total < MIN_PLAYERS) return null;

        const topScore = topSnap.empty ? 0 : (topSnap.docs[0].data().highScore || 0);
        const maxScore = Math.max(runScore, topScore);
        const width = roundWidth(maxScore / BUCKET_TARGET);
        const bucketCount = Math.floor(maxScore / width) + 1;

        // One count per bar, all in parallel. The last bucket is open-ended so
        // the top score always lands in it.
        const bucketsPromise = Promise.all(
            Array.from({ length: bucketCount }, (_, i) =>
                countRange(fb, i * width, i === bucketCount - 1 ? null : (i + 1) * width))
        );
        // Ranked players this run scored at least as well as.
        const beatenPromise = countUsers(fb, [fb.where('highScore', '>', 0), fb.where('highScore', '<=', runScore)]);
        const [buckets, beaten] = await Promise.all([bucketsPromise, beatenPromise]);

        const runBucket = Math.min(bucketCount - 1, Math.floor(runScore / width));
        const percentile = Math.round((beaten / total) * 100);

        return { buckets, width, runBucket, percentile, total };
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
            const fb = firebaseReady();
            const data = fb ? await fetchHistogram(fb, runScore) : null;
            if (!data) {
                container.innerHTML = '<p class="text-slate-500 text-center">Not enough data yet to compare.</p>';
                return;
            }
            render(container, data, runScore);
        } catch (err) {
            console.error('Histogram error:', err);
            // Never let a failed histogram break the end screen.
            container.classList.add('hidden');
        }
    };
})();
