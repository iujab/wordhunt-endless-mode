// This script is only for the landing page (index.html)

document.addEventListener('DOMContentLoaded', () => {
    const loadingText = document.getElementById('loading-text');
    const modeButtons = document.getElementById('mode-buttons');

    setTimeout(() => {
        loadingText.textContent = 'Sign up or login to save your high score!';
        modeButtons.classList.remove('hidden');
    }, 500); // A brief simulated delay
});