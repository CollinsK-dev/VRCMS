document.addEventListener('DOMContentLoaded', () => {
    const verifyModal = document.getElementById('verifyModal');
    const closeVerifyModal = document.getElementById('closeVerifyModal');
    const emailInput = document.getElementById('verifyEmail');
    const userEmailSpan = document.getElementById('userEmail');
    const messageDisplay = document.getElementById('verifyMessage');
    const verificationForm = document.getElementById('verificationForm');
    const resendLink = document.getElementById('resendCode');
    
    // Setup modal functionality
    if (closeVerifyModal) {
        closeVerifyModal.addEventListener('click', () => {
            verifyModal.classList.remove('active');
            window.location.href = 'register.html';
        });
    }

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === verifyModal) {
            verifyModal.classList.remove('active');
            window.location.href = 'register.html';
        }
    });

    // 1. Auto-fill email from URL
    const urlParams = new URLSearchParams(window.location.search);
    const emailFromUrl = urlParams.get('email');
    if (emailFromUrl) {
        const decodedEmail = decodeURIComponent(emailFromUrl);
        emailInput.value = decodedEmail;
        userEmailSpan.textContent = decodedEmail; // Display the email on the page
    }

    // 2. Handle form submission
    verificationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        messageDisplay.style.display = 'none';

        const email = emailInput.value;
        const code = document.getElementById('verification_code').value;

        try {
            showProcessing('Please wait...');
            try {
                await fetchAPI('/auth/verify', {
                    method: 'POST',
                    body: JSON.stringify({ email, code }),
                    showProcessing: false
                });
            } finally {
                try { hideProcessing(); } catch (e) { /* swallow */ }
            }

            // Show success as an alert (consistent with other parts of the system)
            try { alert('Verification successful! You can now log in.'); } catch (e) { /* fallback */ }
            // Close modal and redirect immediately
            verifyModal.classList.remove('active');
            window.location.href = 'login.html';
        } catch (error) {
            console.error('Verification Error:', error);
            messageDisplay.textContent = error.message || 'Network error. Could not connect to the server.';
            messageDisplay.classList.add('alert-error');
            messageDisplay.style.display = 'block';
        }
    });

    // 3. Handle "Resend Code" link
    resendLink.addEventListener('click', async (e) => {
        e.preventDefault();
        messageDisplay.style.display = 'none';

        const email = emailInput.value;
        if (!email) {
            messageDisplay.textContent = 'Please enter your email to resend the code.';
            messageDisplay.classList.add('alert-error');
            messageDisplay.style.display = 'block';
            return;
        }

        try {
            showProcessing('Please wait...');
            try {
                const result = await fetchAPI('/auth/resend-code', {
                    method: 'POST',
                    body: JSON.stringify({ email }),
                    showProcessing: false
                });
                try { alert(result.message || 'Verification code resent'); } catch (e) { /* fallback */ }
            } finally {
                try { hideProcessing(); } catch (e) { /* swallow */ }
            }
        } catch (error) {
            messageDisplay.textContent = error.message || 'Network error. Could not resend code.';
            messageDisplay.classList.add('alert-error');
            messageDisplay.style.display = 'block';
        }
    });
});
