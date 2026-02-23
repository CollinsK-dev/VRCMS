document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('error-message');
    // Create a per-page processing element (placed below the login button)
    let processingEl = document.getElementById('login-processing');
    if (!processingEl) {
        processingEl = document.createElement('div');
        processingEl.id = 'login-processing';
        processingEl.className = 'processing-inline';
        processingEl.style.display = 'none';
        processingEl.style.marginTop = '10px';
        processingEl.style.fontSize = '0.95rem';
        processingEl.style.color = '#333';
        processingEl.textContent = 'Processing, please wait...';
        
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        if (submitBtn && submitBtn.parentNode) {
            submitBtn.parentNode.insertBefore(processingEl, submitBtn.nextSibling);
        } else {
            // fallback to appending to the form
            loginForm.appendChild(processingEl);
        }
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        // Show inline processing and disable submit to prevent double-posts
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        try {
            if (submitBtn) submitBtn.disabled = true;
            processingEl.style.display = 'block';

            const data = await fetchAPI('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password }),
                showProcessing: false // use per-page processing UI instead of global overlay
            });

            console.log('Login response:', data);

            // Ensure we received an access token
            if (!data || !data.access_token) {
                // If server provided a message, show it; otherwise generic error
                showError((data && data.message) ? data.message : 'Login failed: no token received');
                return;
            }

            // On successful login, save the token and user info (store under both keys for compatibility)
            localStorage.setItem('token', data.access_token);
            localStorage.setItem('authToken', data.access_token);
            localStorage.setItem('userRole', data.role);
            localStorage.setItem('username', data.username);

            // Role-based redirection — use absolute paths to ensure navigation
            console.log('Login succeeded for role:', data.role);
            switch (data.role) {
                case 'superadmin':
                    window.location.href = '/superadmin_dashboard.html';
                    break;
                case 'admin':
                    window.location.href = '/admin_dashboard.html';
                    break;
                case 'auditor':
                    window.location.href = '/auditor_dashboard.html';
                    break;
                case 'reporter':
                    window.location.href = '/reporter_dashboard.html';
                    break;
                default:
                    showError('You cannot login. Contact system administrator.');
            }
        } catch (error) {
            showError(error.message || 'Login failed');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
            try { processingEl.style.display = 'none'; } catch (e) {}
        }
    });

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('show');

        setTimeout(() => {
            errorMessage.classList.remove('show');
        }, 2000); // Hide after 2 seconds
    }
});
