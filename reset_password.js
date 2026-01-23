// Reset password functionality
async function handleResetPassword(token, password) {
    try {
        showProcessing('Please wait...');
        try {
            const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token, password })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Failed to reset password');
            }

            return data;
        } finally {
            try { hideProcessing(); } catch (e) { /* swallow */ }
        }
    } catch (error) {
        throw error;
    }
}

document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (password !== confirmPassword) {
        alert('Passwords do not match!');
        return;
    }

    // Get token from URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    
    if (!token) {
        alert('Invalid reset link!');
        return;
    }

    try {
        await handleResetPassword(token, password);
        alert('Password has been reset successfully!');
        window.location.href = 'login.html';
    } catch (error) {
        alert(error.message);
    }
});