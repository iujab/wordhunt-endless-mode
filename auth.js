document.addEventListener('DOMContentLoaded', () => {
    if (!window.firebase) {
        console.error("Firebase is not initialized.");
        return;
    }

    // Import sendEmailVerification
    const { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendEmailVerification, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, writeBatch } = window.firebase;

    // --- DOM Elements ---
    const authModal = document.getElementById('auth-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const authForm = document.getElementById('auth-form');
    const authError = document.getElementById('auth-error');
    const emailVerificationMessage = document.getElementById('email-verification-message');

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
                    // Force a leaderboard refresh after setting a new high score
                    fetchLeaderboard(true); 
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
        usernameField.classList.toggle('hidden', isLoginMode);
        authError.classList.add('hidden');
        emailVerificationMessage.classList.add('hidden');
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
        const email = authForm.email.value;
        const password = authForm.password.value;
        const username = authForm.username.value.trim().toLowerCase();
        
        authError.classList.add('hidden');
        modalSubmitBtn.disabled = true;
        modalSubmitBtn.textContent = 'Processing...';

        try {
            if (isLoginMode) {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                if (!userCredential.user.emailVerified) {
                    await sendEmailVerification(userCredential.user);
                    throw new Error("Please verify your email before logging in. Another email has been sent.");
                }
            } else {
                // Sign Up Logic
                if (!/^[a-z0-9_]{3,15}$/.test(username)) {
                    throw new Error('Username must be 3-15 characters long and can only contain lowercase letters, numbers, and underscores.');
                }
                const usernameRef = doc(db, 'usernames', username);
                const usernameSnap = await getDoc(usernameRef);
                if (usernameSnap.exists()) {
                    throw new Error('This username is already taken.');
                }
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                await sendEmailVerification(user);

                const batch = writeBatch(db);
                const userDocRef = doc(db, "users", user.uid);
                batch.set(userDocRef, {
                    username: username,
                    email: user.email,
                    highScore: 0,
                    createdAt: new Date()
                });
                batch.set(usernameRef, { uid: user.uid });
                await batch.commit();
                
                authForm.style.display = 'none';
                emailVerificationMessage.classList.remove('hidden');
                modalTitle.textContent = 'Check Your Email';
            }
            if(isLoginMode) closeModal();
        } catch (error) {
            switch (error.code) {
                case 'auth/invalid-credential':
                    authError.textContent = 'Invalid email or password.';
                    break;
                case 'auth/email-already-in-use':
                    authError.textContent = 'An account already exists with this email address.';
                    break;
                case 'auth/weak-password':
                    authError.textContent = 'Password should be at least 6 characters long.';
                    break;
                case 'auth/invalid-email':
                    authError.textContent = 'Please enter a valid email address.';
                    break;
                case 'auth/too-many-request':
                    authError.textContent = 'Too many auth requests.';
                    break;
                default:
                    authError.textContent = 'An unexpected error occurred. Please try again.';
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
        if (user && user.emailVerified) {
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

    // --- Leaderboard Logic with Caching ---
    const fetchLeaderboard = async (forceRefresh = false) => {
        const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
        leaderboardLoading.style.display = 'block';
        leaderboardList.innerHTML = '';

        const cachedLeaderboard = JSON.parse(localStorage.getItem('leaderboardCache'));

        if (cachedLeaderboard && !forceRefresh) {
            const isCacheValid = (new Date().getTime() - cachedLeaderboard.timestamp) < CACHE_DURATION;
            if (isCacheValid) {
                renderLeaderboard(cachedLeaderboard.data);
                return;
            }
        }

        try {
            const usersRef = collection(db, "users");
            const q = query(usersRef, orderBy("highScore", "desc"), limit(15));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                leaderboardLoading.textContent = "No scores yet. Be the first!";
                return;
            }
            
            const leaderboardData = [];
            querySnapshot.forEach(doc => {
                 leaderboardData.push(doc.data());
            });

            // Save to cache
            const cacheData = {
                timestamp: new Date().getTime(),
                data: leaderboardData
            };
            localStorage.setItem('leaderboardCache', JSON.stringify(cacheData));

            renderLeaderboard(leaderboardData);

        } catch (error) {
            console.error("Error fetching leaderboard:", error);
            leaderboardLoading.textContent = "Could not load leaderboard.";
        }
    };
    
    const renderLeaderboard = (data) => {
        leaderboardList.innerHTML = '';
        let rank = 1;
        data.forEach(userData => {
            const listItem = document.createElement('li');
            listItem.className = 'flex justify-between items-center text-slate-700';
            listItem.innerHTML = `
                <div class="flex items-center">
                    <span class="font-bold w-6">${rank}.</span>
                    <span>${userData.username}</span>
                </div>
                <span class="font-bold text-blue-600">${new Intl.NumberFormat().format(userData.highScore)}</span>
            `;
            leaderboardList.appendChild(listItem);
            rank++;
        });
        leaderboardLoading.style.display = 'none';
    };

    fetchLeaderboard();
});
