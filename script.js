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

// --- Game Configuration & State ---
const GRID_SIZE = 4;
const GAME_DURATION = 90;
const CUSTOM_DICE = [
    "AEIOUY", "AHMNRS", "BCDFGK", "EILPST", "EKLNXZ", "EFGHIJ",
    "ADENOV", "WFLRTV", "CIMPQU", "GHJOTW", "BKNOPZ", "CDLMSY",
    "ABDEGT", "IJKSUV", "OPRTUX", "XYZVWB"
];
let DICTIONARY = new Set();
let PREFIXES = new Set();
let grid = [];
let score = 0;
let timer = GAME_DURATION;
let timerInterval = null;
let gameMode = '';
let allPossibleWords = new Set();
let foundWords = new Set();
let isPlaying = false;
let isDragging = false;
let selectedTiles = [];
let selectedLines = [];

// --- Dictionary & Game Initialization ---
async function initializeDictionary() {
    try {
        const response = await fetch('./words_dictionary.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const wordObject = await response.json();
        const wordList = Object.keys(wordObject).map(word => word.toUpperCase());
        DICTIONARY = new Set(wordList);
        PREFIXES = new Set();
        for (const word of DICTIONARY) {
            for (let i = 1; i < word.length; i++) {
                PREFIXES.add(word.substring(0, i));
            }
        }
        return true;
    } catch (error) {
        console.error("Could not load dictionary:", error);
        if (gameContainer) gameContainer.innerHTML = `<div class="text-red-500 p-4">Error: Could not load dictionary. Please check the file path and ensure it's a valid JSON.</div>`;
        return false;
    }
}

async function initializeGame(mode) {
    const dictionaryLoaded = await initializeDictionary();
    if (!dictionaryLoaded) return;
    gameMode = mode;
    isPlaying = true;
    if (gameMode === 'endless') {
        timerLabel.style.display = 'none';
        timerEl.innerHTML = '&infin;';
        revealBtn.classList.remove('hidden');
        newBoardBtn.classList.remove('hidden');
        document.getElementById('words-list-container').style.display = 'block';
        revealBtn.addEventListener('click', handleRevealAnswers);
        newBoardBtn.addEventListener('click', () => handleNewBoard(false));
    } else {
        timerLabel.style.display = 'block';
        timerEl.textContent = GAME_DURATION;
        startTimer();
    }
    handleNewBoard(true);
    addEventListeners();
}

// --- Core Game Logic ---
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

// --- EDITED: renderGrid is now more robust to prevent duplicate boards ---
function renderGrid() {
    // Specifically find and remove all old tile elements
    gridContainer.querySelectorAll('.tile').forEach(tile => tile.remove());

    for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
            const tile = document.createElement('div');
            tile.textContent = grid[i][j];
            tile.dataset.row = i;
            tile.dataset.col = j;
            tile.className = 'tile bg-white rounded-lg flex items-center justify-center text-2xl sm:text-3xl font-bold text-slate-700 cursor-pointer select-none';
            // Insert the new tile before the SVG element to keep it on top
            gridContainer.insertBefore(tile, traceSvg);
        }
    }
}

function generateTraceLattice() {
    traceSvg.innerHTML = '';
    const tileElements = Array.from(gridContainer.querySelectorAll('.tile'));
    if (tileElements.length === 0) return;

    const tileCoords = tileElements.map(tile => {
        const rect = tile.getBoundingClientRect();
        const containerRect = gridContainer.getBoundingClientRect();
        return {
            row: parseInt(tile.dataset.row),
            col: parseInt(tile.dataset.col),
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top + rect.height / 2,
        };
    });

    const namespace = "http://www.w3.org/2000/svg";
    for (let i = 0; i < tileCoords.length; i++) {
        for (let j = i + 1; j < tileCoords.length; j++) {
            const tileA = tileCoords[i];
            const tileB = tileCoords[j];

            const isAdjacent = Math.abs(tileA.row - tileB.row) <= 1 && Math.abs(tileA.col - tileB.col) <= 1;

            if (isAdjacent) {
                const line = document.createElementNS(namespace, 'line');
                line.setAttribute('x1', tileA.x);
                line.setAttribute('y1', tileA.y);
                line.setAttribute('x2', tileB.x);
                line.setAttribute('y2', tileB.y);

                const id1 = `tile-${tileA.row}-${tileA.col}`;
                const id2 = `tile-${tileB.row}-${tileB.col}`;
                line.id = [id1, id2].sort().join('--');

                traceSvg.appendChild(line);
            }
        }
    }
}

function startTimer() {
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
    if (gameMode === 'timed') timerEl.textContent = '0';
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

    setTimeout(generateTraceLattice, 50);

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
        case 3:
            points = 100;
            break;
        case 4:
            points = 400;
            break;
        case 5:
            points = 800;
            break;
        case 6:
            points = 1400;
            break;
        default:
            if (len >= 7) {
                points = 1400 + (len - 6) * 400;
            }
            break;
    }
    score += points;
    scoreEl.textContent = new Intl.NumberFormat().format(score);
}

function revealWordInList(word) {
    const wordEl = possibleWordsEl.querySelector(`[data-word="${word}"]`);
    if (wordEl) {
        wordEl.textContent = word;
        wordEl.classList.remove('word-placeholder');
        wordEl.classList.add('word-found');
    }
}


// --- Interaction Logic & Visual Feedback ---
function updatePathColors() {
    const word = selectedTiles.map(t => t.textContent).join('').toUpperCase();
    let tileClass = 'potential';
    let lineClass = 'potential';

    if (allPossibleWords.has(word) && !foundWords.has(word)) {
        tileClass = 'valid';
        lineClass = 'valid';
    }

    document.querySelectorAll('.tile.selected').forEach(t => t.classList.remove('potential', 'valid'));
    selectedTiles.forEach(tile => tile.classList.add(tileClass));

    selectedLines.forEach(line => {
        line.classList.remove('potential', 'valid');
        line.classList.add(lineClass);
    });
}

function flashInvalidPath(tilesToFlash, linesToFlash) {
    tilesToFlash.forEach(tile => {
        tile.classList.remove('potential', 'valid', 'selected');
        tile.classList.add('invalid');
    });
    linesToFlash.forEach(line => {
        line.classList.remove('potential', 'valid');
        line.classList.add('invalid');
    });

    setTimeout(() => {
        tilesToFlash.forEach(tile => tile.classList.remove('invalid'));
        linesToFlash.forEach(line => line.classList.remove('invalid'));
    }, 300);
}

function resetSelection() {
    selectedTiles.forEach(tile => tile.classList.remove('selected', 'potential', 'valid', 'invalid'));
    selectedLines.forEach(line => line.classList.remove('potential', 'valid', 'invalid'));
    selectedTiles = [];
    selectedLines = [];
    currentWordEl.textContent = '';
}

function selectTile(tile) {
    if (selectedTiles.length > 0) {
        const prevTile = selectedTiles[selectedTiles.length - 1];
        const id1 = `tile-${prevTile.dataset.row}-${prevTile.dataset.col}`;
        const id2 = `tile-${tile.dataset.row}-${tile.dataset.col}`;
        const lineId = [id1, id2].sort().join('--');
        const line = document.getElementById(lineId);
        if (line) {
            selectedLines.push(line);
        }
    }

    tile.classList.add('selected');
    selectedTiles.push(tile);
    currentWordEl.textContent = selectedTiles.map(t => t.textContent).join('');
    updatePathColors();
}

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
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const element = document.elementFromPoint(clientX, clientY);

    if (element && element.classList.contains('tile') && !selectedTiles.includes(element)) {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const radius = (rect.width / 2) * 1; //We are just cutting corners
        const distance = Math.sqrt(Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2));

        if (distance <= radius) {
            const lastTile = selectedTiles[selectedTiles.length - 1];
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

    const word = selectedTiles.map(tile => tile.textContent).join('').toUpperCase();
    const tilesToProcess = [...selectedTiles];
    const linesToProcess = [...selectedLines];

    isDragging = false;
    resetSelection();

    if (tilesToProcess.length === 0) return;

    const isAWord = allPossibleWords.has(word);
    const isAlreadyFound = foundWords.has(word);

    if (isAWord && !isAlreadyFound) {
        foundWords.add(word);
        updateScore(word);
        if (gameMode === 'endless') {
            revealWordInList(word);
            updateWordCount();
        }
    } else if (isAWord && isAlreadyFound) {
        // Do nothing.
    } else if (tilesToProcess.length > 0) {
        flashInvalidPath(tilesToProcess, linesToProcess);
    }
}

function addEventListeners() {
    gridContainer.addEventListener('mousedown', handleInteractionStart);
    gridContainer.addEventListener('mousemove', handleInteractionMove);
    window.addEventListener('mouseup', handleInteractionEnd);
    gridContainer.addEventListener('touchstart', handleInteractionStart, {
        passive: false
    });
    gridContainer.addEventListener('touchmove', handleInteractionMove, {
        passive: false
    });
    window.addEventListener('touchend', handleInteractionEnd, {
        passive: false
    });
}

function removeEventListeners() {
    gridContainer.removeEventListener('mousedown', handleInteractionStart);
    gridContainer.removeEventListener('mousemove', handleInteractionMove);
    window.removeEventListener('mouseup', handleInteractionEnd);
    gridContainer.removeEventListener('touchstart', handleInteractionStart);
    gridContainer.removeEventListener('touchmove', handleInteractionMove);
    window.removeEventListener('touchend', handleInteractionEnd);
}