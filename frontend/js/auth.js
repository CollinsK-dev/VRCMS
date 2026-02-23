// Provides centralized authentication-related utility functions.
/**
 * Logs a user in by sending their credentials to the API.
 * @param {string} password - The user's password.
    window.location.href = 'login.html';
        console.error('Login failed:', error);
        // Re-throw the error so the calling function (in login.js) can handle it.
        throw error;
    }
}

/**
 * Logs the user out by clearing authentication-related data from localStorage
 * and redirecting to the login page.
 */
function logout() {
    console.log('Logging out user...');
    // Selectively remove auth-related items to avoid clearing other stored data.
    // Use 'token' to match what is set during login and used by fetchAPI.
    localStorage.removeItem('token');
    localStorage.removeItem('userRole');
    localStorage.removeItem('username');
    
    window.location.replace('login.html');
}


// On page load, enforce authentication for protected pages. 
(function enforceAuthOnLoad() {
    window.addEventListener('DOMContentLoaded', () => {
        try {
            const path = window.location.pathname.split('/').pop();
            // Pages that should be accessible without auth
            const publicPages = new Set([
                '', // root
                'index.html',
                'login.html',
                'register.html',
                'verify.html'
            ]);

            // If this is a public page, do nothing.
            if (publicPages.has(path)) return;

            // Otherwise, require a token. If missing, redirect to login.
            const token = localStorage.getItem('token') || localStorage.getItem('authToken');
            if (!token) {
                // Force navigation to login so the browser won't allow viewing the page
                // from cache/back-button; the server also sets no-cache headers for HTML.
                window.location.replace('login.html');
            }
        } catch (err) {
            // Fail-safe: if anything goes wrong, redirect to login to be safe.
            console.error('Auth check failed:', err);
            window.location.replace('login.html');
        }
    });
})();
