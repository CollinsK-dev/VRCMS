document.addEventListener('DOMContentLoaded', () => {
    const userInfo = document.getElementById('user-info');
    const logoutBtn = document.getElementById('logoutBtn');
    const errorMessage = document.getElementById('error-message');
    const reportTitleEl = document.getElementById('reportTitle');
    const reportIdEl = document.getElementById('reportId');
    const reassignForm = document.getElementById('reassignForm');

    const username = localStorage.getItem('username');
    if (username) {
        userInfo.textContent = `Welcome, ${username}`;
    }


    const reportId = localStorage.getItem('reassignReportId');
    const reportTitle = localStorage.getItem('reassignReportTitle');

    if (!reportId || !reportTitle) {
        alert("No report selected for reassignment. Returning to dashboard.");
        window.location.href = 'admin_dashboard.html';
        return;
    }

    reportTitleEl.textContent = reportTitle;
    reportIdEl.textContent = reportId;

    reassignForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const assigneeNameEl = document.getElementById('assigneeName');
        const assigneeEmailEl = document.getElementById('assigneeEmail');
        const assigneeName = assigneeNameEl ? assigneeNameEl.value.trim() : '';
        const assigneeEmail = assigneeEmailEl ? assigneeEmailEl.value.trim() : '';

        if (!assigneeName || !assigneeEmail) {
            showError("Please enter both an assignee name and email.");
            return;
        }

        // Basic email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(assigneeEmail)) {
            showError('Please enter a valid email address for the assignee.');
            return;
        }

        try {
            showProcessing('Please wait...');
            try {
                const result = await fetchAPI(`/admin/reports/${reportId}/assign`, {
                    method: 'PATCH',
                    body: JSON.stringify({ assignee_name: assigneeName, assignee_email: assigneeEmail, type: 'reassignment' }),
                    showProcessing: false
                });
                // hide processing before showing the alert
                try { hideProcessing(); } catch (e) { /* swallow */ }

                alert(result.message);
                localStorage.removeItem('reassignReportId');
                localStorage.removeItem('reassignReportTitle');
                window.location.href = 'admin_dashboard.html';
            } catch (err) {
                try { hideProcessing(); } catch (e) { /* swallow */ }
                throw err;
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
        }, 2000); // Hide after 2 seconds
    }
});
