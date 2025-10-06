document.addEventListener('DOMContentLoaded', () => {
    if (!window.firebase) {
        console.error("Firebase is not initialized.");
        return;
    }

    const {
        auth,
        db,
        getStorage,
        storageRef,
        uploadBytes,
        getDownloadURL,
        createUserWithEmailAndPassword,
        signInWithEmailAndPassword,
        onAuthStateChanged,
        signOut,
        doc,
        setDoc,
        getDoc,
        collection,
        query,
        where,
        orderBy,
        limit,
        getDocs,
        writeBatch,
        onSnapshot
    } = window.firebase;

    const DEFAULT_PFP = 'default_pfp.svg';
    const userPfpImg = document.getElementById('user-pfp-img');
    const updatePfpBtn = document.getElementById('update-pfp-btn');
    const updatePfpInput = document.getElementById('update-pfp-input');


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
            const userDocRef = doc(db, 'users', user.uid);
            const docSnap = await getDoc(userDocRef);
            if (docSnap.exists()) {
                    const data = docSnap.data();
                    const pfp = data.pfpUrl || DEFAULT_PFP;
                    if (userPfpImg) userPfpImg.src = pfp;
                    if (!data.pfpUrl) {
                        await setDoc(userDocRef, { pfpUrl: DEFAULT_PFP }, { merge: true });
                    }
                const currentHighScore = docSnap.data().highScore || 0;
                if (score > currentHighScore) {
                    await setDoc(userDocRef, { highScore: score }, { merge: true });
                    userHighscoreEl.textContent = new Intl.NumberFormat().format(score);
                }
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
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                    await setDoc(userDocRef, { pfpUrl: DEFAULT_PFP }, { merge: true });
                if (!/^[a-z0-9_]{3,15}$/.test(username)) {
                    throw { code: 'auth/invalid-username' };
                }
                const usernameRef = doc(db, 'usernames', username);
                if ((await getDoc(usernameRef)).exists()) {
                    throw { code: 'auth/email-already-in-use' };
                }
                const { user } = await createUserWithEmailAndPassword(auth, email, password);
                const batch = writeBatch(db);
                batch.set(doc(db, 'users', user.uid), {
                    username,
                    highScore: 0,
                    createdAt: new Date()
                });
                batch.set(usernameRef, { uid: user.uid });
                await batch.commit();
            }
            closeModal();
        } catch (error) {
            switch (error.code) {
                case 'auth/invalid-credential':
                case 'auth/wrong-password':
                case 'auth/user-not-found':
                    authError.textContent = 'Invalid username or password.';
                    break;
                case 'auth/invalid-username':
                case 'auth/invalid-email':
                    authError.textContent = 'Username contains invalid characters.';
                    break;
                case 'auth/email-already-in-use':
                    authError.textContent = 'This username is already taken.';
                    break;
                case 'auth/weak-password':
                    authError.textContent = 'Password must be at least 6 characters long.';
                    break;
                case 'auth/operation-not-allowed':
                    authError.textContent = 'Sign-up is currently disabled. Please try again later.';
                    break;
                case 'auth/too-many-requests':
                    authError.textContent = 'Too many attempts. Please wait and try again.';
                    break;
                case 'auth/internal-error':
                    authError.textContent = 'An internal error occurred. Please try again later.';
                    break;
                default:
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
    logoutBtn.addEventListener('click', () => signOut(auth));

    // --- Auth State Listener ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists()) {
                const data = userDoc.data();
                const highScore = data.highScore || 0;

                // Update user info display
                userDisplayNameEl.textContent = data.username;
                userHighscoreEl.textContent = new Intl.NumberFormat().format(highScore);
                
                // Rank Calculation Logic
                const rankEl = document.getElementById('user-rank');
                if (rankEl) {
                    // Check if score is 0 before calculating rank
                    if (highScore === 0) {
                        rankEl.textContent = 'N/A';
                    } else {
                    await setDoc(userDocRef, { pfpUrl: DEFAULT_PFP }, { merge: true });
                        rankEl.textContent = 'Calculating...';
                        const usersRef = collection(db, 'users');
                        const q = query(usersRef, where('highScore', '>', highScore));
                        const querySnapshot = await getDocs(q);
                        const rank = querySnapshot.size + 1;
                        rankEl.textContent = `#${new Intl.NumberFormat().format(rank)}`;
                    }
                }
            }
            
            authButtons.classList.add('hidden');
            userInfo.classList.remove('hidden');
            await processPendingScore(user);
        } else {
            await setDoc(userDocRef, { pfpUrl: DEFAULT_PFP }, { merge: true });
            authButtons.classList.remove('hidden');
            userInfo.classList.add('hidden');
        }
    });
    // --- Leaderboard (Real-time) ---
    const listenForLeaderboardUpdates = () => {
        leaderboardLoading.style.display = 'block';
        leaderboardList.innerHTML = '';
        const usersRef = collection(db, 'users');
        const topQuery = query(usersRef, orderBy('highScore', 'desc'), limit(10));
        onSnapshot(topQuery,
            (snapshot) => {
                if (snapshot.empty) {
                    leaderboardLoading.textContent = 'No scores yet. Be the first!';
                    return;
                }
                leaderboardList.innerHTML = snapshot.docs.map((d, idx) => {
    const u = d.data();
    const pfp = u.pfpUrl || 'default_pfp.svg';
    const place = idx + 1;
    return `
      <li class="flex items-center justify-between bg-white/20 backdrop-blur rounded-md px-3 py-2">
        <div class="flex items-center gap-3">
          <span class="text-white/80 w-5 text-right">${place}.</span>
          <img src="${pfp}" alt="pfp" class="w-8 h-8 rounded-full ring-1 ring-white/50" />
          <span class="font-semibold text-white">${u.username || 'player'}</span>
        </div>
        <span class="font-bold text-white">${new Intl.NumberFormat().format(u.highScore || 0)}</span>
      </li>`;
}).join('');
leaderboardLoading.style.display = 'none';
            },
            (err) => {
                console.error('Leaderboard listener error:', err);
                leaderboardLoading.textContent = 'Could not load leaderboard.';
            }
        );
    };

    
    // --- Update PFP ---
    if (updatePfpBtn && updatePfpInput) {
        updatePfpBtn.addEventListener('click', () => updatePfpInput.click());
        updatePfpInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file || !auth.currentUser) return;
            try {
                const storage = getStorage();
                const p = storageRef(storage, `pfp/${auth.currentUser.uid}`);
                await uploadBytes(p, file);
                const url = await getDownloadURL(p);
                const userRef = doc(db, 'users', auth.currentUser.uid);
                await setDoc(userRef, { pfpUrl: url }, { merge: true });
                if (userPfpImg) userPfpImg.src = url;
            } catch (err) {
                console.error('PFP upload failed', err);
                alert('Could not update profile picture. Try a smaller image?');
            } finally {
                updatePfpInput.value = '';
            }
        });
    }

    listenForLeaderboardUpdates();
});
