document.addEventListener('DOMContentLoaded', () => {
    const userRole = localStorage.getItem('userRole');
    if (userRole !== 'superadmin') {
        alert('Access Denied. Superadmin only.');
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('superadminRegistrationForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const messageDisplay = document.getElementById('message');
        messageDisplay.style.display = 'none';

        try {
            showProcessing('Please wait...');
            try {
                const payload = { username, email, password, role: 'superadmin' };
                const result = await fetchAPI('/admin/users', { method: 'POST', body: JSON.stringify(payload), showProcessing: false });
                messageDisplay.textContent = result.message || 'Superadmin created';
                messageDisplay.className = 'alert alert-success';
                messageDisplay.style.display = 'block';
                document.getElementById('superadminRegistrationForm').reset();
            } finally {
                try { hideProcessing(); } catch (e) { /* swallow */ }
            }
        } catch (err) {
            messageDisplay.textContent = err.message || 'Failed to create superadmin';
            messageDisplay.className = 'alert alert-error';
            messageDisplay.style.display = 'block';
        }
    });
});
