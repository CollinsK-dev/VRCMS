document.addEventListener('DOMContentLoaded', () => {
    // Only superadmin may create new admin accounts
    const userRole = localStorage.getItem('userRole');
    if (userRole !== 'superadmin') {
        alert("Access Denied. Superadmin only.");
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('adminRegistrationForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const messageDisplay = document.getElementById('message');

        messageDisplay.style.display = 'none';

        try {
            showProcessing('Please wait...');
            try {
                const adminData = { username, email, password, role: 'admin' };

                const result = await fetchAPI('/admin/users', {
                    method: 'POST',
                    body: JSON.stringify(adminData),
                    showProcessing: false
                });

                messageDisplay.textContent = result.message;
                messageDisplay.className = 'alert alert-success';
                messageDisplay.style.display = 'block';
                document.getElementById('adminRegistrationForm').reset();
            } finally {
                try { hideProcessing(); } catch (e) { /* swallow */ }
            }
        } catch (error) {
            messageDisplay.textContent = error.message || 'Network error. Could not register admin.';
            messageDisplay.className = 'alert alert-error';
            messageDisplay.style.display = 'block';
        }
    });
});
