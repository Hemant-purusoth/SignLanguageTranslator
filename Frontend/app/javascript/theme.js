document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('themeToggle');
    const rootElement = document.documentElement;

    // Check for saved theme preference or use system preference
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
        rootElement.setAttribute('data-theme', 'dark');
        updateToggleButton(true);
    } else {
        rootElement.setAttribute('data-theme', 'light');
        updateToggleButton(false);
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const isDarkMode = rootElement.getAttribute('data-theme') === 'dark';

            if (isDarkMode) {
                rootElement.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
                updateToggleButton(false);
            } else {
                rootElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
                updateToggleButton(true);
            }
        });
    }

    function updateToggleButton(isDark) {
        if (!themeToggleBtn) return;
        if (isDark) {
            themeToggleBtn.innerHTML = '<i class="fas fa-sun"></i>';
            themeToggleBtn.setAttribute('aria-label', 'Switch to Light Mode');
        } else {
            themeToggleBtn.innerHTML = '<i class="fas fa-moon"></i>';
            themeToggleBtn.setAttribute('aria-label', 'Switch to Dark Mode');
        }
    }
});
