// Build API base URL from the current page origin so requests are always same-origin with the served frontend.
// This prevents subtle CORS issues when the page is served from 'localhost' but the API base was set to '127.0.0.1' (or vice-versa).
const API_BASE_URL = `${window.location.protocol}//${window.location.host}/api`;

// Small UI helper exposed globally so pages can show success notifications
// Some pages define a local `showSuccess` but others call it assuming a global helper exists. 
// Defining it here avoids "showSuccess is not defined" runtime errors.
function showSuccess(message) {
    try {
        const el = document.getElementById('success-message');
        if (el) {
                // Use a CSS class `show` for consistent styling
                el.textContent = message;
                el.classList.add('show');
                // Auto-hide after a short, consistent delay (1s)
                setTimeout(() => {
                    el.classList.remove('show');
                    el.textContent = '';
                }, 1000);
            return;
        }
    } catch (e) {
        // ignore DOM errors and fall back to alert
    }

    // Fallback when no UI element is present
    try { alert(message); } catch (e) { /* ignore */ }
}

/**
 * A centralized utility for making API requests.
 * It automatically adds the Content-Type and Authorization headers.
 * @param {string} endpoint - The API endpoint (e.g., '/reports').
 * @param {object} [options={}] - The options for the fetch call (e.g., method, body).
 * @returns {Promise<any>} - The JSON response from the server.
 */
async function fetchAPI(endpoint, options = {}) {
    // Make processing overlay optional: callers may pass { showProcessing: false }
    const showProc = options.showProcessing !== false;
    if (showProc) showProcessing();

    try {
    // Support both legacy key names. Most pages set 'token', older code used 'authToken'. Prefer 'token' first.
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...options.headers,
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // Enhanced debug logging - always log token presence
        const tokenDebug = token ? `${token.slice(0,12)}...` : 'NO_TOKEN';
        console.log(`Making API request to ${endpoint}:`, {
            url: `${API_BASE_URL}${endpoint}`,
            method: options.method || 'GET',
            headers: headers,
            token: tokenDebug,
            body: options.body,
            localStorage: {
                token: !!localStorage.getItem('token'),
                authToken: !!localStorage.getItem('authToken'),
                userRole: localStorage.getItem('userRole'),
            }
        });

        // Remove our internal option so it won't be sent to fetch
        const { showProcessing, ...fetchOptions } = options;
        const response = await fetch(`${API_BASE_URL}${endpoint}`, { 
            ...fetchOptions, 
            headers,
            credentials: 'include'
        });

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            // For non-JSON responses (like file downloads), return the raw response object
            return response;
        }

        console.log(`API response for ${endpoint}:`, {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            data: data
        });

        if (!response.ok) {
            // For 401 responses (unauthorized), we normally clear auth and redirect to login.
            // However, for authentication endpoints (like '/auth/login'), we want the caller
            // to receive the error so the login page can show a helpful message instead of being redirected immediately.
            const debugMode = new URL(window.location.href).searchParams.get('debug') === '1';
            if (response.status === 401) {
                const isAuthEndpoint = endpoint && endpoint.toLowerCase().startsWith('/auth');
                console.warn('Received 401 Unauthorized for', endpoint, '- isAuthEndpoint=', isAuthEndpoint);

                if (!isAuthEndpoint) {
                    if (!debugMode) {
                        try {
                            // Clear both keys for compatibility
                            localStorage.removeItem('token');
                            localStorage.removeItem('authToken');
                            localStorage.removeItem('userRole');
                            localStorage.removeItem('username');
                        } catch (e) {
                            console.error('Error clearing localStorage on 401:', e);
                        }
                        try { 
                            window.location.href = 'login.html';
                            return;
                        } catch (e) {}
                    } else {
                        console.warn('Debug mode enabled: not redirecting on 401.');
                    }
                }
 // If this is an auth endpoint (login/register/etc.), fall through and throw the error so the page can show the server-provided message.
            }

            // Create and throw a single error with message from server
            const error = new Error(data.message || `Request failed with status ${response.status}`);
            error.status = response.status;
            error.response = data;
            error.statusText = response.statusText;
            throw error;
        }
        return data;
    } catch (error) {
// Treat 404 (not found) as a warning to avoid noisy stack traces in the console when the frontend intentionally probes for resources that may
// not exist (for example: feedback entries pointing to deleted reports).
        try {
            if (error && error.status === 404) {
                console.warn(`API 404 for ${endpoint}:`, { message: error.message });
            } else {
                console.error(`API call to ${endpoint} failed:`, {
                    error: error,
                    message: error.message,
                    stack: error.stack
                });
            }
        } catch (logErr) {
            // Ensure we don't crash logging the error
            console.error('Failed logging API error', logErr);
        }
        throw error;
    } finally {
        try { if (showProc) hideProcessing(); } catch (e) { /* swallow */ }
    }
}

// Processing overlay helpers: shown during long-running operations (blocks UI)
function showProcessing(message = 'Processing, please wait...') {
    try {
        let overlay = document.getElementById('processing-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'processing-overlay';
            overlay.className = 'processing-overlay';
            overlay.innerHTML = `
                <div class="processing-box">
                    <div class="spinner" aria-hidden="true"></div>
                    <div class="processing-text">${message}</div>
                </div>`;
            document.body.appendChild(overlay);
        } else {
            const text = overlay.querySelector('.processing-text');
            if (text) text.textContent = message;
        }
        overlay.classList.add('active');
        // Prevent background scrolling / interactions
        document.body.style.overflow = 'hidden';
    } catch (e) {
        console.warn('Failed to show processing overlay', e);
    }
}

function hideProcessing() {
    try {
        const overlay = document.getElementById('processing-overlay');
        if (overlay) {
            overlay.classList.remove('active');
            // remove after a short delay so fade-out animations can run
                setTimeout(() => {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                }, 150);
        }
        document.body.style.overflow = '';
    } catch (e) {
        console.warn('Failed to hide processing overlay', e);
    }
}