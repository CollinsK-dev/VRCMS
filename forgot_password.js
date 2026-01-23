let userEmail = '';

// Forgot password functionality
async function handleForgotPassword(email) {
    try {
        showProcessing('Please wait...');
        try {
            const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Failed to process forgot password request');
            }

            return data;
        } finally {
            try { hideProcessing(); } catch (e) { /* swallow */ }
        }
    } catch (error) {
        throw error;
    }
}

// Verify reset code functionality
async function verifyResetCode(email, code) {
    try {
        showProcessing('Please wait...');
        try {
            const response = await fetch(`${API_BASE_URL}/auth/verify-reset-code`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, code })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Failed to verify code');
            }

            return data;
        } finally {
            try { hideProcessing(); } catch (e) { /* swallow */ }
        }
    } catch (error) {
        throw error;
    }
}

// Show specified step and hide others
function showStep(stepNumber) {
    document.querySelectorAll('.step').forEach(step => {
        step.classList.remove('active');
    });
    document.getElementById(`step${stepNumber}`).classList.add('active');
}

// Handle forgot password form submission
document.getElementById('forgotPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    userEmail = email; // Store email for later use
    
    try {
        await handleForgotPassword(email);
        alert('Verification code has been sent to your email.');
        showStep(2);
    } catch (error) {
        alert(error.message);
    }
});

// Handle verification code form submission
document.getElementById('verificationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('code').value;
    
    try {
        const result = await verifyResetCode(userEmail, code);
        // Redirect to reset password page with the temporary token
        window.location.href = `reset_password.html?token=${result.token}`;
    } catch (error) {
        alert(error.message);
    }
});