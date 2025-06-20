// This script is only for the landing page (index.html)

document.addEventListener('DOMContentLoaded', () => {
    const loadingText = document.getElementById('loading-text');
    const modeButtons = document.getElementById('mode-buttons');

    setTimeout(() => {
        loadingText.textContent = 'Select a Game Mode';
        modeButtons.classList.remove('hidden');
    }, 500); // A brief simulated delay
});