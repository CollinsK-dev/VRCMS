document.addEventListener('DOMContentLoaded', () => {
    // Only superadmin may create new auditor accounts
    const userRole = localStorage.getItem('userRole');
    if (userRole !== 'superadmin') {
        alert("Access Denied. Superadmin only.");
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('auditorRegistrationForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const messageDisplay = document.getElementById('message');

        messageDisplay.style.display = 'none';

        try {
            showProcessing('Please wait...');
            try {
                const auditorData = { username, email, password, role: 'auditor' };

                const result = await fetchAPI('/admin/users', {
                    method: 'POST',
                    body: JSON.stringify(auditorData),
                    showProcessing: false
                });

                messageDisplay.textContent = result.message;
                messageDisplay.className = 'alert alert-success';
                messageDisplay.style.display = 'block';
                document.getElementById('auditorRegistrationForm').reset();
            } finally {
                try { hideProcessing(); } catch (e) { /* swallow */ }
            }
        } catch (error) {
            messageDisplay.textContent = error.message || 'Network error. Could not register auditor.';
            messageDisplay.className = 'alert alert-error';
            messageDisplay.style.display = 'block';
        }
    });
});
