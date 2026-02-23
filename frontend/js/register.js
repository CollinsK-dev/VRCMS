document.addEventListener('DOMContentLoaded', () => {
    const registrationForm = document.getElementById('registrationForm');
    const errorMessage = document.getElementById('error-message');

    registrationForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirm_password').value;
        const department = document.getElementById('department').value;

        if (password !== confirmPassword) {
            showError('Passwords do not match.');
            return;
        }

        try {
            // Show a small local "please wait" message right below the form submit button
            showLocalProcessing(registrationForm, 'Please wait...');
            try {
                const data = await fetchAPI('/auth/register', {
                    method: 'POST',
                    body: JSON.stringify({ username, email, password, department }),
                    showProcessing: false
                });

                // Show verification modal
                const verifyModal = document.getElementById('verifyModal');
                const verifyEmail = document.getElementById('verifyEmail');
                const userEmailSpan = document.getElementById('userEmail');
                
                verifyEmail.value = email;
                userEmailSpan.textContent = email;
                verifyModal.classList.add('active');
            } finally {
                try { hideLocalProcessing(registrationForm); } catch (e) { /* swallow */ }
            }
        } catch (error) {
            showError(error.message);
        }
    });

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('show');

        setTimeout(() => {
            errorMessage.classList.remove('show');
        }, 1000); // Hide after 1 second
    }

    // Local processing indicator shown under the form submit button for this page only
    function showLocalProcessing(formEl, message) {
        try {
            const submitBtn = formEl.querySelector('button[type="submit"]');
            if (!submitBtn) return;
            let proc = formEl.querySelector('.local-processing');
            if (!proc) {
                proc = document.createElement('div');
                proc.className = 'local-processing';
                proc.style.marginTop = '10px';
                proc.style.fontSize = '0.95rem';
                proc.style.color = '#333';
                submitBtn.insertAdjacentElement('afterend', proc);
            }
            proc.textContent = message || 'Please wait...';
            proc.style.display = 'block';
        } catch (e) { console.warn('Failed to show local processing message', e); }
    }

    function hideLocalProcessing(formEl) {
        try {
            const proc = formEl.querySelector('.local-processing');
            if (proc) proc.style.display = 'none';
        } catch (e) { console.warn('Failed to hide local processing message', e); }
    }
});
