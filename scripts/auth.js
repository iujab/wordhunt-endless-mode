document.addEventListener('DOMContentLoaded', () => {
    if (!window.supa) {
        console.error("Supabase is not initialized.");
        return;
    }

    const supa = window.supa;

    // --- DOM Elements ---
    const authModal = document.getElementById('auth-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const authForm = document.getElementById('auth-form');
    const authError = document.getElementById('auth-error');

    const loginModalBtn = document.getElementById('login-modal-btn');
    const signupModalBtn = document.getElementById('signup-modal-btn');
    const logoutBtn = document.getElementById('logout-btn');

    const modalTitle = document.getElementById('modal-title');
    const modalSubmitBtn = document.getElementById('modal-submit-btn');
    const usernameField = document.getElementById('username-field');

    const userInfo = document.getElementById('user-info');
    const authButtons = document.getElementById('auth-buttons');
    const userDisplayNameEl = document.getElementById('user-display-name');
    const userHighscoreEl = document.getElementById('user-highscore');

    const leaderboardList = document.getElementById('leaderboard-list');
    const leaderboardLoading = document.getElementById('leaderboard-loading');

    let isLoginMode = true;

    // --- Process any saved score after login ---
    const processPendingScore = async (user) => {
        const lastScore = localStorage.getItem('lastTimedScore');
        if (!user || lastScore === null) return;

        const score = parseInt(lastScore, 10);
        localStorage.removeItem('lastTimedScore');
        if (isNaN(score)) return;

        try {
            // The database clamps high_score to greatest(old, new), so this is
            // a no-op unless the run beat the stored score.
            const { data, error } = await supa
                .from('profiles')
                .update({ high_score: score })
                .eq('id', user.id)
                .select('high_score')
                .maybeSingle();
            if (error) throw error;
            if (data) {
                userHighscoreEl.textContent = new Intl.NumberFormat().format(data.high_score);
            }
        } catch (err) {
            console.error('Error updating score:', err);
        }
    };

    // --- Modal Controls ---
    const openModal = (loginMode = true) => {
        isLoginMode = loginMode;
        modalTitle.textContent = isLoginMode ? 'Login' : 'Sign Up';
        modalSubmitBtn.textContent = isLoginMode ? 'Login' : 'Sign Up';
        authError.classList.add('hidden');
        authForm.reset();
        authModal.classList.remove('hidden');
    };

    const closeModal = () => authModal.classList.add('hidden');

    loginModalBtn.addEventListener('click', () => openModal(true));
    signupModalBtn.addEventListener('click', () => openModal(false));
    modalCloseBtn.addEventListener('click', closeModal);

    // --- Authentication Handler ---
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = authForm.username.value.trim().toLowerCase();
        const password = authForm.password.value;
        const DUMMY_DOMAIN = 'endlesswordhunt.firebaseapp.com';
        const email = `${username}@${DUMMY_DOMAIN}`;

        authError.classList.add('hidden');
        modalSubmitBtn.disabled = true;
        modalSubmitBtn.textContent = 'Processing...';

        try {
            if (isLoginMode) {
                // Existing user login
                const { error } = await supa.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else {
                // Sign up
                if (!/^[a-z0-9_]{3,15}$/.test(username)) {
                    throw { code: 'invalid_username' };
                }

                const { data: existing, error: checkError } = await supa
                    .from('profiles')
                    .select('id')
                    .eq('username', username)
                    .maybeSingle();
                if (checkError) throw checkError;
                if (existing) throw { code: 'username_taken' };

                // A database trigger creates the profile row from this metadata;
                // if the username was taken in a race, the whole signup fails.
                const { data, error } = await supa.auth.signUp({
                    email,
                    password,
                    options: { data: { username } }
                });
                if (error) throw error;

                // With email confirmation disabled, signUp returns a session
                // directly; if not, log in explicitly.
                if (!data.session) {
                    const { error: loginError } = await supa.auth.signInWithPassword({ email, password });
                    if (loginError) throw loginError;
                }
            }

            closeModal();
        } catch (error) {
            const code = error.code || '';
            const msg = error.message || '';

            if (code === 'invalid_credentials' || msg.includes('Invalid login credentials')) {
                authError.textContent = 'Invalid username or password.';
            } else if (code === 'invalid_username' || code === 'validation_failed') {
                authError.textContent = 'Username must be 3–15 chars (a–z, 0–9, _).';
            } else if (code === 'username_taken'
                || code === 'user_already_exists'
                || msg.includes('already registered')
                || msg.includes('Database error saving new user')) {
                authError.textContent = 'This username is already taken.';
            } else if (code === 'weak_password' || msg.includes('at least 6 characters')) {
                authError.textContent = 'Password must be at least 6 characters long.';
            } else if (code === 'signup_disabled') {
                authError.textContent = 'Sign-up is currently disabled. Please try again later.';
            } else if (code === 'over_request_rate_limit' || error.status === 429) {
                authError.textContent = 'Too many attempts. Please wait and try again.';
            } else if (code === 'email_not_confirmed') {
                authError.textContent = 'This account is awaiting confirmation. Please try again later.';
                console.error('Auth error: email confirmation appears to be enabled in Supabase — disable "Confirm email" for the username+password flow to work.');
            } else {
                authError.textContent = 'An unexpected error occurred. Please try again.';
                console.error('Authentication error:', error);
            }
            authError.classList.remove('hidden');
        } finally {
            modalSubmitBtn.disabled = false;
            modalSubmitBtn.textContent = isLoginMode ? 'Login' : 'Sign Up';
        }
    });

    // --- Logout ---
    logoutBtn.addEventListener('click', () => supa.auth.signOut());

    // --- Signed-in UI ---
    const renderSignedIn = async (user) => {
        try {
            const { data: profile, error } = await supa
                .from('profiles')
                .select('username, high_score')
                .eq('id', user.id)
                .maybeSingle();
            if (error) throw error;

            if (profile) {
                const highScore = profile.high_score || 0;

                userDisplayNameEl.textContent = profile.username;
                userHighscoreEl.textContent = new Intl.NumberFormat().format(highScore);

                // Rank Calculation Logic
                const rankEl = document.getElementById('user-rank');
                if (rankEl) {
                    if (highScore === 0) {
                        rankEl.textContent = 'N/A';
                    } else {
                        rankEl.textContent = 'Calculating...';
                        // Server-side count of players with a better score.
                        const { count, error: countError } = await supa
                            .from('profiles')
                            .select('*', { count: 'exact', head: true })
                            .gt('high_score', highScore);
                        if (countError) throw countError;
                        const rank = (count || 0) + 1;
                        rankEl.textContent = `#${new Intl.NumberFormat().format(rank)}`;
                    }
                }
            } else {
                // Account without a profile row (should not happen post-migration).
                userDisplayNameEl.textContent = (user.email || 'player').split('@')[0];
                userHighscoreEl.textContent = '0';
            }
        } catch (err) {
            console.error('Failed to load profile:', err);
        }

        authButtons.classList.add('hidden');
        userInfo.classList.remove('hidden');

        await processPendingScore(user);
    };

    // --- Auth State Listener ---
    supa.auth.onAuthStateChange((event, session) => {
        // Deferred so supabase-js's internal auth lock is released before we
        // run queries from within the callback.
        setTimeout(() => {
            if (session?.user) {
                renderSignedIn(session.user);
            } else {
                authButtons.classList.remove('hidden');
                userInfo.classList.add('hidden');
            }
        }, 0);
    });

    // --- Leaderboard (Real-time) ---
    const loadLeaderboard = async () => {
        const { data, error } = await supa
            .from('profiles')
            .select('username, high_score')
            .order('high_score', { ascending: false })
            .limit(10);

        if (error) {
            console.error('Leaderboard error:', error);
            leaderboardLoading.textContent = 'Could not load leaderboard.';
            return;
        }

        if (!data.length) {
            leaderboardLoading.textContent = 'No scores yet. Be the first!';
            return;
        }

        leaderboardList.innerHTML = data.map((u, idx) => `
            <li class="flex justify-between items-center">
                <div class="flex items-center">
                    <span class="font-bold w-6 text-white">${idx + 1}.</span>
                    <span class="text-white">${u.username}</span>
                </div>
                <span class="font-bold text-white">${new Intl.NumberFormat().format(u.high_score)}</span>
            </li>`).join('');

        leaderboardLoading.style.display = 'none';
    };

    leaderboardLoading.style.display = 'block';
    loadLeaderboard();

    // Refresh whenever any profile changes (score submissions, new players).
    supa.channel('leaderboard')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => loadLeaderboard())
        .subscribe();
});
