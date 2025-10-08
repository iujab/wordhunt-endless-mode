// --- DOM Elements ---
const gameContainer = document.getElementById('game-container');
const loadingText = document.getElementById('loading-text');
const gridContainer = document.getElementById('grid-container');
const traceSvg = document.getElementById('trace-svg');
const currentWordEl = document.getElementById('current-word');
const scoreEl = document.getElementById('score');
const timerContainer = document.getElementById('timer-container');
const timerLabel = document.getElementById('timer-label');
const timerEl = document.getElementById('timer');
const possibleWordsEl = document.getElementById('possible-words');
const wordCountEl = document.getElementById('word-count');
const revealBtn = document.getElementById('reveal-btn');
const newBoardBtn = document.getElementById('new-board-btn');
const gameButtonsContainer = document.getElementById('game-buttons');
const messageOverlay = document.getElementById('message-overlay');
const messageText = document.getElementById('message-text');
const messageScore = document.getElementById('message-score');

// --- Constants & Configuration ---
const GRID_SIZE = 4;
const GAME_DURATION = 90;
const CUSTOM_DICE = [
    "AEIOUY","AHMNRS","EILPST","EILPST","EKLNXY","EFGHIJ",
    "ADENOV","WFLRTV","CIMPQU","GHJOTW","BKNOPZ","CDLMSY",
    "EBDEGT","IJKSUV","OPRTUX","AEIOUN","AEIOUE","EERLST",
    "THNDSO","BINGES","CRANES","PEOELE","LECHTK","ERGAIL"
];
const RICH_BOARD_ATTEMPTS = 2; // Increased attempts for even better boards, leave as 2, best of 2
const DIRECTIONS = [
    [-1,-1],[-1,0],[-1,1],
    [0,-1],       [0,1],
    [1,-1], [1,0], [1,1]
];

// --- Game State ---
let DICTIONARY = new Set();
let PREFIXES   = new Set();
let grid       = [];
let score      = 0;
let timer      = GAME_DURATION;
let timerInterval = null;
let gameMode   = '';
let allPossibleWords = new Set();
let foundWords = new Set();
let isPlaying  = false;
let isDragging = false;
let selectedTiles = [];
let selectedLines = [];
let jingleSound = null; // We still preload the jingle, but will create new instances for overlap

// --- Audio Initialization ---
function loadAudio() {
    try {
        // We only need to preload the jingle now. The tick is created on the fly.
        jingleSound = new Audio('assets/jingle.mp3');
        jingleSound.preload = 'auto';
        jingleSound.load();
    } catch (err) {
        console.error("Could not load audio files:", err);
        jingleSound = null;
    }
}

// --- Dictionary Initialization ---
async function initializeDictionary() {
    try {
        const resp = await fetch('./assets/words_dictionary.json');
        if (!resp.ok) throw new Error(`status ${resp.status}`);
        const obj = await resp.json();
        DICTIONARY = new Set(Object.keys(obj).map(w => w.toUpperCase()));
        PREFIXES.clear();
        DICTIONARY.forEach(w => {
            for (let i = 1; i < w.length; i++) {
                PREFIXES.add(w.substring(0, i));
            }
        });
        return true;
    } catch (err) {
        console.error("Could not load dictionary:", err);
        if (gameContainer) {
            gameContainer.innerHTML = `<div class="text-red-500 p-4">Error loading dictionary. Check path and JSON.</div>`;
        }
        return false;
    }
}

// --- Game Initialization ---
async function initializeGame() {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    gameMode = (mode === 'timed' || mode === 'endless') ? mode : 'endless';

    if (!(await initializeDictionary())) return;
    
    loadAudio();
    isPlaying = true;

    // --- Get all UI elements ---
    const pageTitle = document.querySelector('title');
    const gameSubtitle = document.getElementById('game-subtitle');
    const wordsListContainer = document.getElementById('words-list-container');
    const timedWordsWrapper = document.getElementById('timed-words-wrapper');
    const playAgainBtn = document.getElementById('message-close-btn');
    const endlessButtons = document.getElementById('endless-buttons');
    const timedButton = document.getElementById('timed-button');

    // --- Configure UI based on the game mode ---
    if (gameMode === 'endless') {
        pageTitle.textContent = 'Endless Wordhunt';
        gameSubtitle.textContent = '*Scroll down to see remaining and completed words';
        timerLabel.style.display = 'none';
        timerEl.innerHTML = '&infin;';
        
        wordsListContainer.style.display = 'block';
        endlessButtons.classList.remove('hidden');
        timedButton.classList.add('hidden');
        
        revealBtn?.addEventListener('click', handleRevealAnswers);
        newBoardBtn?.addEventListener('click', () => handleNewBoard(false));
        playAgainBtn.href = 'game.html?mode=endless';

    } else { // Timed Mode
        pageTitle.textContent = 'Timed Wordhunt';
        gameSubtitle.textContent = '*Log in to save your personal best';
        timerLabel.style.display = 'block';
        timerEl.textContent = GAME_DURATION;
        
        endlessButtons.classList.add('hidden');
        timedButton.classList.remove('hidden');
        
        timedWordsWrapper.style.display = 'block';
        playAgainBtn.href = 'game.html?mode=timed';
        
        startTimer();
    }

    handleNewBoard(true);
    addEventListeners();
}

// --- Grid & Tracing ---
function generateGrid() {
    grid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(''));
    const dice = [...CUSTOM_DICE];
    for (let i = dice.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dice[i], dice[j]] = [dice[j], dice[i]];
    }
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            const die = dice[r * GRID_SIZE + c];
            grid[r][c] = die[Math.floor(Math.random() * die.length)];
        }
    }
}

function renderGrid() {
    if (!gridContainer) return;
    gridContainer.querySelectorAll('.tile').forEach(t => t.remove());
    const frag = document.createDocumentFragment();
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            const tile = document.createElement('div');
            tile.textContent = grid[r][c];
            tile.dataset.row = r;
            tile.dataset.col = c;
            tile.className = 'tile rounded-lg flex items-center justify-center text-2xl sm:text-3xl font-bold text-black cursor-pointer select-none';
            frag.appendChild(tile);
        }
    }
    gridContainer.insertBefore(frag, traceSvg);
}

function generateTraceLattice() {
    if (!traceSvg) return;
    traceSvg.innerHTML = '';
    const tiles = Array.from(gridContainer.querySelectorAll('.tile'));
    if (!tiles.length) return;

    const contRect = gridContainer.getBoundingClientRect();
    const coords = tiles.map(tile => {
        const rect = tile.getBoundingClientRect();
        const centerX = rect.left - contRect.left + rect.width / 2;
        const centerY = rect.top - contRect.top + rect.height / 2;
        tile.dataset.centerX = centerX;
        tile.dataset.centerY = centerY;
        return {
            row: +tile.dataset.row, col: +tile.dataset.col,
            x: centerX, y: centerY
        };
    });

    const ns = "http://www.w3.org/2000/svg";
    const frag = document.createDocumentFragment();
    for (let i = 0; i < coords.length; i++) {
        for (let j = i + 1; j < coords.length; j++) {
            const a = coords[i], b = coords[j];
            if (Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1) {
                const line = document.createElementNS(ns, 'line');
                line.setAttribute('x1', a.x);
                line.setAttribute('y1', a.y);
                line.setAttribute('x2', b.x);
                line.setAttribute('y2', b.y);
                line.id = [`tile-${a.row}-${a.col}`, `tile-${b.row}-${b.col}`].sort().join('--');
                frag.appendChild(line);
            }
        }
    }
    traceSvg.appendChild(frag);
}


// --- Timer ---
function startTimer() {
    if (gameMode !== 'timed') return;
    clearInterval(timerInterval);
    timer = GAME_DURATION;
    timerEl.textContent = timer;
    timerInterval = setInterval(() => {
        timer--;
        timerEl.textContent = timer;
        if (timer <= 0) endGame("Time's Up!");
    }, 1000);
}

// --- End Game ---
function endGame(message) {
    isPlaying = false;
    clearInterval(timerInterval);

    if (gameMode === 'timed') {
        timerEl.textContent = '0';
        localStorage.setItem('lastTimedScore', score);
        renderTimedWords();
    }

    messageText.textContent = message;
    messageScore.textContent = `Your final score is ${new Intl.NumberFormat().format(score)}.`;

    if (messageOverlay) messageOverlay.classList.remove('hidden');
    removeEventListeners();
}

// --- Solving ---
function solveBoard(currentGrid) {
    const found = new Set();
    const visited = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(false));
    
    function dfs(r, c, w) {
        if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE || visited[r][c]) return;
        
        w += currentGrid[r][c];
        
        if (!PREFIXES.has(w) && !DICTIONARY.has(w)) return;
        
        if (w.length >= 3 && DICTIONARY.has(w)) {
            found.add(w);
        }
        
        visited[r][c] = true;
        for (const [dr, dc] of DIRECTIONS) {
            dfs(r + dr, c + dc, w);
        }
        visited[r][c] = false; // backtrack
    }
    
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            dfs(r, c, "");
        }
    }
    return found;
}


// --- Word List & Count ---
function renderPossibleWords() {
    if (!possibleWordsEl) return;
    possibleWordsEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    Array.from(allPossibleWords)
      .sort((a,b) => b.length - a.length || a.localeCompare(b))
      .forEach(w => {
        const d = document.createElement('div');
        d.dataset.word = w;
        d.className = 'word-placeholder';
        d.textContent = '_ '.repeat(w.length);
        frag.appendChild(d);
      });
    possibleWordsEl.appendChild(frag);
    updateWordCount();
}

function updateWordCount() {
    if (!wordCountEl) return;
    wordCountEl.textContent = `${foundWords.size} / ${allPossibleWords.size}`;
}

// --- Reveal Answers ---
function handleRevealAnswers() {
    allPossibleWords.forEach(w => {
      if (!foundWords.has(w)) {
        foundWords.add(w);
        updateScore(w);
        revealWordInList(w);
      }
    });
    updateWordCount();
    if (revealBtn) revealBtn.disabled = true;
}

// --- New Board (rich) ---
function handleNewBoard(isFirstTime = false) {
    if (gameMode === 'timed' && !isFirstTime) return;
    score = 0;
    foundWords.clear();
    if (scoreEl) scoreEl.textContent = '0';
    if (messageOverlay) messageOverlay.classList.add('hidden');

    let bestGrid = null;
    let bestWords = new Set();

    for (let i = 0; i < RICH_BOARD_ATTEMPTS; i++) {
        generateGrid();
        const currentWords = solveBoard(grid);
        if (currentWords.size > bestWords.size) {
            bestWords = currentWords;
            bestGrid = grid.map(row => [...row]);
        }
    }
    
    grid = bestGrid || grid;
    allPossibleWords = bestWords;

    renderGrid();
    setTimeout(generateTraceLattice, 50);

    if (gameMode === 'endless') {
        renderPossibleWords();
        if (revealBtn) revealBtn.disabled = false;
    }
    resetSelection();
}

// --- Scoring & Reveal ---
function updateScore(word) {
    let pts = 0, L = word.length;
    if (L === 3) pts = 100;
    else if (L === 4) pts = 400;
    else if (L === 5) pts = 800;
    else if (L === 6) pts = 1400;
    else if (L >= 7) pts = 1400 + (L - 6) * 400;
    score += pts;
    if (scoreEl) scoreEl.textContent = new Intl.NumberFormat().format(score);
}

function revealWordInList(word) {
    if (!possibleWordsEl) return;
    const el = possibleWordsEl.querySelector(`[data-word="${word}"]`);
    if (el) {
        el.textContent = word;
        el.classList.remove('word-placeholder');
        el.classList.add('word-found');
    }
}

// --- Path Coloring & Flash ---
function updatePathColors() {
    const w = selectedTiles.map(t => t.textContent).join('').toUpperCase();
    const isValid = allPossibleWords.has(w) && !foundWords.has(w);
    const tileClass = isValid ? 'valid' : 'potential';

    selectedTiles.forEach(t => {
      t.classList.remove('potential','valid');
      t.classList.add(tileClass);
    });
    selectedLines.forEach(l => {
      l.classList.remove('potential','valid');
      l.classList.add(tileClass);
    });
}

function flashInvalidPath(tiles, lines) {
    tiles.forEach(t => {
      t.classList.remove('potential','valid','selected');
      t.classList.add('invalid');
    });
    lines.forEach(l => {
      l.classList.remove('potential','valid');
      l.classList.add('invalid');
    });
    setTimeout(() => {
      tiles.forEach(t => t.classList.remove('invalid'));
      lines.forEach(l => l.classList.remove('invalid'));
    }, 300);
}

// --- Selection Reset ---
function resetSelection() {
    selectedTiles.forEach(t => t.classList.remove('selected','potential','valid','invalid'));
    selectedLines.forEach(l => l.classList.remove('potential','valid','invalid'));
    selectedTiles = [];
    selectedLines = [];
    if (currentWordEl) currentWordEl.textContent = '';
}

// --- Tile Selection ---
function selectTile(tile) {
    new Audio('assets/tick.mp3').play();
    
    if (selectedTiles.length > 0) {
        const prev = selectedTiles[selectedTiles.length - 1];
        const id = [`tile-${prev.dataset.row}-${prev.dataset.col}`, `tile-${tile.dataset.row}-${tile.dataset.col}`].sort().join('--');
        const ln = document.getElementById(id);
        if (ln) selectedLines.push(ln);
    }
    tile.classList.add('selected');
    selectedTiles.push(tile);
    if (currentWordEl) {
      currentWordEl.textContent = selectedTiles.map(t => t.textContent).join('');
    }
    updatePathColors();
}

// --- Interaction Handlers ---
function handleInteractionStart(e) {
    if (!isPlaying) return;
    e.preventDefault();
    const tile = e.target.closest('.tile');
    if (tile) {
        isDragging = true;
        resetSelection();
        selectTile(tile);
    }
}

function handleInteractionMove(e) {
    if (!isDragging || !isPlaying) return;
    e.preventDefault();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const el = document.elementFromPoint(x, y);

    if (!el || !el.classList.contains('tile') || selectedTiles.includes(el)) return;
    
    const centerX = +el.dataset.centerX;
    const centerY = +el.dataset.centerY;
    const rect = el.getBoundingClientRect();
    const contRect = gridContainer.getBoundingClientRect();

    const dx = (x - contRect.left) - centerX;
    const dy = (y - contRect.top) - centerY;
    const rad = rect.width / 2;

    if (dx * dx + dy * dy <= rad * rad) {
        const last = selectedTiles[selectedTiles.length - 1];
        if (Math.abs(+el.dataset.row - +last.dataset.row) <= 1 && Math.abs(+el.dataset.col - +last.dataset.col) <= 1) {
            selectTile(el);
        }
    }
}

function handleInteractionEnd(e) {
    if (!isDragging || !isPlaying) return;
    if (e) e.preventDefault(); // Check if e exists, as we might call this manually

    const word = selectedTiles.map(t => t.textContent).join('').toUpperCase();
    const tilesInPath = [...selectedTiles];
    const linesInPath = [...selectedLines];

    isDragging = false;
    resetSelection();

    if (tilesInPath.length < 3) return;

    const isAWord = allPossibleWords.has(word);
    const isAlreadyFound = foundWords.has(word);

    if (isAWord && !isAlreadyFound) {
        new Audio('assets/jingle.mp3').play(); // JINGLE FIX: Play new instance for overlap
        foundWords.add(word);
        updateScore(word);
        if (gameMode === 'endless') {
            revealWordInList(word);
            updateWordCount();
        }
    } else if (!isAWord) {
        flashInvalidPath(tilesInPath, linesInPath);
    }
}

// This is the new handler for the freeze bug
function handleMouseLeave(e) {
    if (isDragging) {
        handleInteractionEnd(e);
    }
}

// --- Event Listeners ---
function addEventListeners() {
    if (!gridContainer) return;
    gridContainer.addEventListener('mousedown', handleInteractionStart);
    gridContainer.addEventListener('mousemove', handleInteractionMove);
    window.addEventListener('mouseup', handleInteractionEnd);
    gridContainer.addEventListener('touchstart', handleInteractionStart, {passive:false});
    gridContainer.addEventListener('touchmove', handleInteractionMove, {passive:false});
    window.addEventListener('touchend', handleInteractionEnd, {passive:false});
    // FREEZE FIX: Add listener for when mouse leaves the document
    document.body.addEventListener('mouseleave', handleMouseLeave);
}

function removeEventListeners() {
    if (!gridContainer) return;
    gridContainer.removeEventListener('mousedown', handleInteractionStart);
    gridContainer.removeEventListener('mousemove', handleInteractionMove);
    window.removeEventListener('mouseup', handleInteractionEnd);
    gridContainer.removeEventListener('touchstart', handleInteractionStart);
    gridContainer.removeEventListener('touchmove', handleInteractionMove);
    window.removeEventListener('touchend', handleInteractionEnd);
    // FREEZE FIX: Remove the corresponding listener
    document.body.removeEventListener('mouseleave', handleMouseLeave);
}

function renderTimedWords() {
  const listEl = document.getElementById('timed-words-list');
  if (!listEl || !allPossibleWords) return;
  listEl.innerHTML = '';

  Array.from(allPossibleWords)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .forEach(word => {
      const li = document.createElement('li');
      li.textContent = word;
      if (foundWords.has(word)) {
        li.className = 'text-green-600 font-semibold';
      } else {
        li.className = 'text-red-600';
      }
      listEl.appendChild(li);
    });
}