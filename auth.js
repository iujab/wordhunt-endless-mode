document.addEventListener('DOMContentLoaded', () => {
    if (!window.firebase) {
        console.error("Firebase is not initialized.");
        return;
    }

    const { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, writeBatch, onSnapshot } = window.firebase;

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

    // --- Function to process a pending score ---
    const processPendingScore = async (user) => {
        const lastScore = localStorage.getItem('lastTimedScore');
        if (lastScore === null) return;

        const score = parseInt(lastScore, 10);
        localStorage.removeItem('lastTimedScore');

        if (!user || isNaN(score)) return;

        const userDocRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userDocRef);
            if (docSnap.exists()) {
                const currentHighScore = docSnap.data().highScore || 0;
                if (score > currentHighScore) {
                    await setDoc(userDocRef, { highScore: score }, { merge: true });
                    userHighscoreEl.textContent = new Intl.NumberFormat().format(score);
                }
            }
        } catch (error) {
            console.error("Error submitting score:", error);
        }
    };

    // --- Modal Control ---
    const openModal = (loginMode = true) => {
        isLoginMode = loginMode;
        modalTitle.textContent = isLoginMode ? 'Login' : 'Sign Up';
        modalSubmitBtn.textContent = isLoginMode ? 'Login' : 'Sign Up';
        // MODIFIED: Username field is now always visible.
        authError.classList.add('hidden');
        authForm.reset();
        authModal.classList.remove('hidden');
    };

    const closeModal = () => {
        authModal.classList.add('hidden');
    };

    loginModalBtn.addEventListener('click', () => openModal(true));
    signupModalBtn.addEventListener('click', () => openModal(false));
    modalCloseBtn.addEventListener('click', closeModal);

    // --- Authentication Logic ---
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        // MODIFIED: Only get username and password from the form.
        const password = authForm.password.value;
        const username = authForm.username.value.trim().toLowerCase();

        // We create dummy email for firebase since it is required
        // This is never shown to the user.
        const DUMMY_DOMAIN = "endlesswordhunt.firebaseapp.com";
        const email = `${username}@${DUMMY_DOMAIN}`;

        authError.classList.add('hidden');
        modalSubmitBtn.disabled = true;
        modalSubmitBtn.textContent = 'Processing...';

        try {
            if (isLoginMode) {
                // Login with the dummy email.
                await signInWithEmailAndPassword(auth, email, password);
                //REMOVED: Email verification check.
            } else {
                // Sign Up Logic
                if (!/^[a-z0-9_]{3,15}$/.test(username)) {
                    throw new Error('Username must be 3-15 characters long and can only contain letters, numbers, and underscores.');
                }
                const usernameRef = doc(db, 'usernames', username);
                const usernameSnap = await getDoc(usernameRef);
                if (usernameSnap.exists()) {
                    throw new Error('This username is already taken.');
                }

                // Create user with the dummy email.
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // REMOVED: sendEmailVerification call.

                const batch = writeBatch(db);
                const userDocRef = doc(db, "users", user.uid);
                // MODIFIED: We only store the username, not the dummy email.
                batch.set(userDocRef, {
                    username: username,
                    highScore: 0,
                    createdAt: new Date()
                });
                batch.set(usernameRef, { uid: user.uid });
                await batch.commit();

                // REMOVED: Logic to show the email verification message.
            }
            closeModal(); // Close modal on successful login OR sign up.
        } catch (error) {
            switch (error.code) {
                case 'auth/invalid-credential':
                    authError.textContent = 'Invalid username or password.';
                    break;
                case 'auth/email-already-in-use': // This now effectively means the username is taken
                    authError.textContent = 'This username is already taken.';
                    break;
                case 'auth/weak-password':
                    authError.textContent = 'Password should be at least 6 characters long.';
                    break;
                case 'auth/invalid-email': // This can happen if username has chars that are invalid for an email prefix
                    authError.textContent = 'Username contains invalid characters.';
                    break;
                case 'auth/too-many-requests':
                     authError.textContent = 'Too many requests. Please try again later.';
                     break;
                default:
                    authError.textContent = error.message || 'An unexpected error occurred. Please try again.';
                    break;
            }
            authError.classList.remove('hidden');
        } finally {
            modalSubmitBtn.disabled = false;
            modalSubmitBtn.textContent = isLoginMode ? 'Login' : 'Sign Up';
        }
    });

    logoutBtn.addEventListener('click', () => signOut(auth));

    // --- Auth State Listener ---
    onAuthStateChanged(auth, async (user) => {
        // MODIFIED: Removed the user.emailVerified check.
        if (user) {
            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
                const userData = userDocSnap.data();
                userDisplayNameEl.textContent = userData.username;
                userHighscoreEl.textContent = new Intl.NumberFormat().format(userData.highScore);
            }
            authButtons.classList.add('hidden');
            userInfo.classList.remove('hidden');

            await processPendingScore(user);
        } else {
            authButtons.classList.remove('hidden');
            userInfo.classList.add('hidden');
        }
    });

    // --- Leaderboard Logic with Real-Time Listener ---
    const listenForLeaderboardUpdates = () => {
        leaderboardLoading.style.display = 'block';
        leaderboardList.innerHTML = '';

        try {
            const usersRef = collection(db, "users");
            const q = query(usersRef, orderBy("highScore", "desc"), limit(15));

            onSnapshot(q, (querySnapshot) => {
                if (querySnapshot.empty) {
                    leaderboardLoading.textContent = "No scores yet. Be the first!";
                    return;
                }

                const leaderboardData = [];
                querySnapshot.forEach(doc => {
                     leaderboardData.push(doc.data());
                });

                renderLeaderboard(leaderboardData);
            }, (error) => {
                console.error("Error with leaderboard listener:", error);
                leaderboardLoading.textContent = "Could not load leaderboard.";
            });

        } catch (error) {
            console.error("Error setting up leaderboard listener:", error);
            leaderboardLoading.textContent = "Could not load leaderboard.";
        }
    };

    const renderLeaderboard = (data) => {
        leaderboardList.innerHTML = '';
        let rank = 1;
        data.forEach(userData => {
            const listItem = document.createElement('li');
            listItem.className = 'flex justify-between items-center';
            listItem.innerHTML = `
                <div class="flex items-center">
                    <span class="font-bold w-6 text-white">${rank}.</span>
                    <span class="text-white">${userData.username}</span>
                </div>
                <span class="font-bold text-white">${new Intl.NumberFormat().format(userData.highScore)}</span>
            `;
            leaderboardList.appendChild(listItem);
            rank++;
        });
        leaderboardLoading.style.display = 'none';
    };

    // --- Run on Page Load ---
    listenForLeaderboardUpdates();
});