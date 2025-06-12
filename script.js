// --- DOM Elements ---
const gameContainer = document.getElementById('game-container');
const modeSelection = document.getElementById('mode-selection');
const loadingText = document.getElementById('loading-text');
const modeButtons = document.getElementById('mode-buttons');
const timedModeBtn = document.getElementById('timed-mode-btn');
const endlessModeBtn = document.getElementById('endless-mode-btn');
const gridContainer = document.getElementById('grid-container');
const currentWordEl = document.getElementById('current-word');
const scoreEl = document.getElementById('score');
const timerContainer = document.getElementById('timer-container');
const timerLabel = document.getElementById('timer-label');
const timerEl = document.getElementById('timer');
const possibleWordsEl = document.getElementById('possible-words');
const wordCountEl = document.getElementById('word-count');
const changeModeBtn = document.getElementById('change-mode-btn');
const revealBtn = document.getElementById('reveal-btn');
const newBoardBtn = document.getElementById('new-board-btn');
const gameButtonsContainer = document.getElementById('game-buttons');
const messageOverlay = document.getElementById('message-overlay');
const messageText = document.getElementById('message-text');
const messageScore = document.getElementById('message-score');
const messageCloseBtn = document.getElementById('message-close-btn');

// --- Game Configuration ---
const GRID_SIZE = 4;
const GAME_DURATION = 90;
const CUSTOM_DICE = [
    "AEIOUY", "AHMNRS", "BCDFGK", "EILPST", "EKLNXZ", "EFGHIJ",
    "ADENOV", "WFLRTV", "CIMPQU", "GHJOTW", "BKNOPZ", "CDLMSY",
    "ABDEGT", "IJKSUV", "OPRTUX", "XYZVWB"
];

// --- Game State ---
let DICTIONARY = new Set();
let PREFIXES = new Set();
let grid = [];
let score = 0;
let timer = GAME_DURATION;
let timerInterval = null;
let gameMode = 'timed';
let allPossibleWords = new Set();
let foundWords = new Set();
let isPlaying = false;
let isDragging = false;
let selectedTiles = [];

// --- Dictionary Loading from JSON ---
async function initializeDictionary() {
    try {
        const response = await fetch('./words_dictionary.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const wordObject = await response.json();
        const wordList = Object.keys(wordObject).map(word => word.toUpperCase());

        DICTIONARY = new Set(wordList);

        PREFIXES = new Set();
        for (const word of DICTIONARY) {
            for (let i = 1; i < word.length; i++) {
                PREFIXES.add(word.substring(0, i));
            }
        }
        console.log('JSON Dictionary and prefixes loaded successfully.');
        loadingText.textContent = 'Wordhunt all day all night!';
        modeButtons.classList.remove('hidden');

    } catch (error) {
        console.error("Could not load dictionary:", error);
        loadingText.textContent = "Error: Could not load words_dictionary.json. Please make sure it's in the same directory and is a valid JSON file.";
        loadingText.classList.add('text-red-500');
    }
}

// --- Game Logic ---
function generateGrid() {
    grid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(''));
    let tempDice = [...CUSTOM_DICE];
    for (let i = tempDice.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tempDice[i], tempDice[j]] = [tempDice[j], tempDice[i]];
    }
    for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
            const die = tempDice[i * GRID_SIZE + j];
            grid[i][j] = die[Math.floor(Math.random() * die.length)];
        }
    }
}

function renderGrid() {
    gridContainer.innerHTML = '';
    for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
            const tile = document.createElement('div');
            tile.textContent = grid[i][j];
            tile.dataset.row = i;
            tile.dataset.col = j;
            tile.className = 'tile bg-white rounded-lg flex items-center justify-center text-2xl sm:text-3xl font-bold text-slate-700 cursor-pointer select-none';
            gridContainer.appendChild(tile);
        }
    }
}

function startGame(mode) {
    gameMode = mode;
    modeSelection.classList.add('hidden');
    gameContainer.classList.remove('hidden');

    isPlaying = true;
    
    if (gameMode === 'endless') {
        timerLabel.style.display = 'none';
        timerEl.innerHTML = '&infin;'; // Infinity symbol
        revealBtn.classList.remove('hidden');
        newBoardBtn.classList.remove('hidden');
        gameButtonsContainer.classList.add('sm:grid-cols-3');
        gameButtonsContainer.classList.remove('sm:grid-cols-1');
        document.getElementById('words-list-container').style.display = 'block';
    } else { // Timed mode
        timerLabel.style.display = 'block';
        timerEl.textContent = GAME_DURATION;
        revealBtn.classList.add('hidden');
        newBoardBtn.classList.add('hidden');
        gameButtonsContainer.classList.remove('sm:grid-cols-3');
        gameButtonsContainer.classList.add('sm:grid-cols-1');
        document.getElementById('words-list-container').style.display = 'none'; // Hide word list in timed mode
        startTimer();
    }

    handleNewBoard(true); // Initial board generation
    addEventListeners();
}

function startTimer() {
    // FIX: Ensure timer only runs in 'timed' mode.
    if (gameMode !== 'timed') return;

    timer = GAME_DURATION;
    timerEl.textContent = timer;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timer--;
        timerEl.textContent = timer;
        if (timer <= 0) {
            endGame("Time's Up!");
        }
    }, 1000);
}

function endGame(message) {
    isPlaying = false;
    clearInterval(timerInterval);
    if(gameMode === 'timed') timerEl.textContent = '0';
    messageText.textContent = message;
    messageScore.textContent = `Your final score is ${new Intl.NumberFormat().format(score)}.`;
    messageOverlay.classList.remove('hidden');
    removeEventListeners();
}

function solveBoard() {
    allPossibleWords.clear();
    const visited = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(false));

    function traverse(row, col, currentWord) {
        if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE || visited[row][col]) {
            return;
        }
        currentWord += grid[row][col];
        if (!PREFIXES.has(currentWord) && !DICTIONARY.has(currentWord)) {
            return;
        }
        if (currentWord.length >= 3 && DICTIONARY.has(currentWord)) {
            allPossibleWords.add(currentWord);
        }
        visited[row][col] = true;
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;
                traverse(row + i, col + j, currentWord);
            }
        }
        visited[row][col] = false;
    }

    for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
            traverse(i, j, "");
        }
    }
    console.log(`Board solved. Found ${allPossibleWords.size} possible words.`);
}

function renderPossibleWords() {
    possibleWordsEl.innerHTML = '';
    const sortedWords = Array.from(allPossibleWords).sort((a, b) => {
        if (b.length !== a.length) {
            return b.length - a.length;
        }
        return a.localeCompare(b);
    });
    sortedWords.forEach(word => {
        const wordDiv = document.createElement('div');
        wordDiv.dataset.word = word;
        wordDiv.className = 'word-placeholder';
        wordDiv.textContent = '_ '.repeat(word.length);
        possibleWordsEl.appendChild(wordDiv);
    });
    updateWordCount();
}

function updateWordCount() {
    wordCountEl.textContent = `${foundWords.size} / ${allPossibleWords.size}`;
}

function handleRevealAnswers() {
    allPossibleWords.forEach(word => {
        if (!foundWords.has(word)) {
            foundWords.add(word);
            updateScore(word);
            revealWordInList(word);
        }
    });
    updateWordCount();
    revealBtn.disabled = true;
}

function handleNewBoard(isFirstTime = false) {
     if (gameMode === 'timed' && !isFirstTime) return;

    score = 0;
    foundWords.clear();
    scoreEl.textContent = '0';
    messageOverlay.classList.add('hidden');
    
    generateGrid();
    renderGrid();
    solveBoard();
    
    if (gameMode === 'endless') {
        renderPossibleWords();
        revealBtn.disabled = false;
    }
    
    resetSelection();
}

function updateScore(word) {
    let points = 0;
    const len = word.length;
    switch (len) {
        case 3: points = 100; break;
        case 4: points = 400; break;
        case 5: points = 800; break;
        case 6: points = 1400; break;
        case 7: points = 1800; break;
        case 8: points = 2200; break;
        default:
            if (len > 8) {
                points = 2200 + (len - 8) * 400;
            }
            break;
    }
    score += points;
    scoreEl.textContent = new Intl.NumberFormat().format(score);
}

function updatePathColors() {
    const word = selectedTiles.map(t => t.textContent).join('').toUpperCase();
    let pathClass = 'potential';
    if (allPossibleWords.has(word) && !foundWords.has(word)) {
        pathClass = 'valid';
    }
    document.querySelectorAll('.tile.selected').forEach(t => t.classList.remove('potential', 'valid'));
    selectedTiles.forEach(tile => tile.classList.add(pathClass));
}

function flashInvalidPath() {
    const tilesToFlash = [...selectedTiles];
    tilesToFlash.forEach(tile => {
        tile.classList.remove('potential', 'valid', 'selected');
        tile.classList.add('invalid');
    });
    setTimeout(() => {
        tilesToFlash.forEach(tile => tile.classList.remove('invalid'));
    }, 200);
}

function selectTile(tile) {
    tile.classList.add('selected');
    selectedTiles.push(tile);
    currentWordEl.textContent = selectedTiles.map(t => t.textContent).join('');
    updatePathColors();
}

function revealWordInList(word) {
    const wordEl = possibleWordsEl.querySelector(`[data-word="${word}"]`);
    if (wordEl) {
        wordEl.textContent = word;
        wordEl.classList.remove('word-placeholder');
        wordEl.classList.add('word-found');
    }
}

function resetSelection() {
    selectedTiles.forEach(tile => tile.classList.remove('selected', 'potential', 'valid'));
    selectedTiles = [];
    currentWordEl.textContent = '';
}

function handleInteractionStart(e) {
    if (!isPlaying) return;
    e.preventDefault();
    const tile = e.target.closest('.tile');
    if (tile) {
        isDragging = true;
        selectTile(tile);
    }
}

function handleInteractionMove(e) {
    if (!isDragging || !isPlaying) return;
    e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const element = document.elementFromPoint(clientX, clientY);
    if (element && element.classList.contains('tile') && !element.classList.contains('selected')) {
        const lastTile = selectedTiles[selectedTiles.length - 1];
        if (lastTile) {
            const lastRow = parseInt(lastTile.dataset.row);
            const lastCol = parseInt(lastTile.dataset.col);
            const currentRow = parseInt(element.dataset.row);
            const currentCol = parseInt(element.dataset.col);
            const isAdjacent = Math.abs(currentRow - lastRow) <= 1 && Math.abs(currentCol - lastCol) <= 1;
            if (isAdjacent) {
                selectTile(element);
            }
        }
    }
}

function handleInteractionEnd(e) {
    if (!isDragging || !isPlaying) return;
    e.preventDefault();
    isDragging = false;
    const word = selectedTiles.map(tile => tile.textContent).join('').toUpperCase();
    if (allPossibleWords.has(word)) {
        if (!foundWords.has(word)) {
            foundWords.add(word);
            updateScore(word);
            if (gameMode === 'endless') {
                revealWordInList(word);
                updateWordCount();
                if (foundWords.size === allPossibleWords.size) {
                    endGame("You found all the words!");
                }
            }
        }
    } else if (word.length > 0) {
        flashInvalidPath();
    }
    resetSelection();
}

function addEventListeners() {
    gridContainer.addEventListener('mousedown', handleInteractionStart);
    gridContainer.addEventListener('mousemove', handleInteractionMove);
    window.addEventListener('mouseup', handleInteractionEnd);
    gridContainer.addEventListener('touchstart', handleInteractionStart, { passive: false });
    gridContainer.addEventListener('touchmove', handleInteractionMove, { passive: false });
    window.addEventListener('touchend', handleInteractionEnd, { passive: false });
}

function removeEventListeners() {
    gridContainer.removeEventListener('mousedown', handleInteractionStart);
    gridContainer.removeEventListener('mousemove', handleInteractionMove);
    window.removeEventListener('mouseup', handleInteractionEnd);
    gridContainer.removeEventListener('touchstart', handleInteractionStart);
    gridContainer.removeEventListener('touchmove', handleInteractionMove);
    window.removeEventListener('touchend', handleInteractionEnd);
}

function resetToModeSelection() {
    gameContainer.classList.add('hidden');
    messageOverlay.classList.add('hidden');
    modeSelection.classList.remove('hidden');
    
    // FIX: Explicitly clear the timer interval when changing modes.
    clearInterval(timerInterval);

    removeEventListeners();
}

// --- Initialization ---
timedModeBtn.addEventListener('click', () => startGame('timed'));
endlessModeBtn.addEventListener('click', () => startGame('endless'));
changeModeBtn.addEventListener('click', resetToModeSelection);
revealBtn.addEventListener('click', handleRevealAnswers);
newBoardBtn.addEventListener('click', () => handleNewBoard(false));
messageCloseBtn.addEventListener('click', resetToModeSelection);

initializeDictionary();