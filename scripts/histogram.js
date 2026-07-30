// Renders a histogram of all players' best scores on the timed-mode end screen,
// marking where the run the player just finished lands. Exposes
// window.renderScoreHistogram(runScore), called from script.js's endGame().
//
// Built from a single SQL aggregation (the score_histogram RPC groups every
// ranked player's best score into buckets server-side), plus three tiny
// queries: top score, ranked-player count, and players-beaten count.
(function () {
    const BUCKET_TARGET = 18;   // approximate number of bars
    const MIN_PLAYERS = 5;      // need at least this many ranked players to bother

    // Round a raw bucket width up to a clean multiple of 100 (scores are multiples of 100).
    function roundWidth(raw) {
        return Math.max(100, Math.ceil(raw / 100) * 100);
    }

    // Aggregate the distribution and work out where this run lands. Returns
    // null when there aren't enough ranked players.
    async function fetchHistogram(supa, runScore) {
        // Current top score and ranked-player total, in parallel.
        const [topRes, totalRes] = await Promise.all([
            supa.from('profiles').select('high_score')
                .order('high_score', { ascending: false }).limit(1),
            supa.from('profiles').select('*', { count: 'exact', head: true })
                .gt('high_score', 0)
        ]);
        if (topRes.error) throw topRes.error;
        if (totalRes.error) throw totalRes.error;

        const total = totalRes.count || 0;
        if (total < MIN_PLAYERS) return null;

        const topScore = topRes.data[0]?.high_score || 0;
        const maxScore = Math.max(runScore, topScore);
        const width = roundWidth(maxScore / BUCKET_TARGET);
        const bucketCount = Math.floor(maxScore / width) + 1;

        // One grouped count for all bars, plus the players this run beat.
        const [histRes, beatenRes] = await Promise.all([
            supa.rpc('score_histogram', { bucket_width: width }),
            supa.from('profiles').select('*', { count: 'exact', head: true })
                .gt('high_score', 0).lte('high_score', runScore)
        ]);
        if (histRes.error) throw histRes.error;
        if (beatenRes.error) throw beatenRes.error;

        const buckets = new Array(bucketCount).fill(0);
        for (const row of histRes.data) {
            // Fold anything past the end into the last (open-ended) bucket.
            buckets[Math.min(row.bucket, bucketCount - 1)] += Number(row.players);
        }

        const runBucket = Math.min(bucketCount - 1, Math.floor(runScore / width));
        const percentile = Math.round(((beatenRes.count || 0) / total) * 100);

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
            const supa = window.supa;
            const data = supa ? await fetchHistogram(supa, runScore) : null;
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
