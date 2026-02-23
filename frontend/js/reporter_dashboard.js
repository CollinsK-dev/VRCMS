document.addEventListener('DOMContentLoaded', () => {
    const userInfo = document.getElementById('user-info');
    const logoutBtn = document.getElementById('logoutBtn');
    const reportForm = document.getElementById('reportForm');
    const reportsTableBody = document.querySelector('#reportsTable tbody');
    const errorMessage = document.getElementById('error-message');
    const toggleReportsBtn = document.getElementById('toggleReportsBtn');
    const hideReportsBtn = document.getElementById('hideReportsBtn'); // Close button
    const reportsModal = document.getElementById('reportsModal');

    const username = localStorage.getItem('username');
    if (username) {
        userInfo.textContent = `Welcome, ${username}`;
    }

    // Hide welcome message after 2 seconds
    setTimeout(() => {
        if (userInfo) userInfo.style.display = 'none';
    }, 2000);

    logoutBtn.addEventListener('click', () => {
        logout();
    });

    toggleReportsBtn.addEventListener('click', () => {
        showReports();
    });

    hideReportsBtn.addEventListener('click', () => {
        hideReports();
    });

    reportForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const title = document.getElementById('title').value;
        const severity = document.getElementById('severity').value;
        const details = document.getElementById('details').value;

        try {
            const res = await fetchAPI('/reports', {
                method: 'POST',
                body: JSON.stringify({ title, severity, details })
            });

            reportForm.reset();

            // Wait until the processing overlay is removed, then show an alert success message
            await waitForProcessingHidden(2000);
            try {
                alert(res.message || 'Report submitted successfully. Thank you for your contribution to security.');
            } catch (e) {
                // ignore alert failures in environments without window.alert
            }

            // If reports are visible, refresh them. Otherwise, they'll load when shown.
            if (reportsModal && reportsModal.style.display !== 'none') {
                await loadReports();
            }
        } catch (error) {
            showError(error.message);
        }
    });

    // Helper: wait until the global processing overlay is removed (used to delay alerts until UI unblocks)
    function waitForProcessingHidden(timeout = 2000) {
        return new Promise((resolve) => {
            const interval = 50;
            let waited = 0;
            const checker = setInterval(() => {
                const overlay = document.getElementById('processing-overlay');
                const stillActive = overlay && overlay.classList && overlay.classList.contains('active');
                if (!overlay || !stillActive) {
                    clearInterval(checker);
                    resolve();
                    return;
                }
                waited += interval;
                if (waited >= timeout) {
                    clearInterval(checker);
                    resolve();
                }
            }, interval);
        });
    }

    async function loadReports() {
        try {
            const data = await fetchAPI('/reports/my-reports');
            reportsTableBody.innerHTML = ''; // Clear existing reports

            if (data.items.length === 0) {
                reportsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No reports submitted yet.</td></tr>';
                return;
            }

            data.items.forEach(report => {
                try {
                    const row = document.createElement('tr');
                    const title = report.title || 'Untitled';
                    const severityText = report.severity || 'Unknown';
                    const severityClass = String(severityText).toLowerCase().replace(/\s+/g, '-');
                    const statusText = report.status || 'Unknown';
                    const statusClass = String(statusText).toLowerCase().replace(/\s+/g, '-');
                    const createdAt = report.created_at ? new Date(report.created_at).toLocaleDateString() : '';
                    row.innerHTML = `
                        <td>${title}</td>
                        <td><span class="status-badge ${severityClass}">${severityText}</span></td>
                        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                        <td>${createdAt}</td>
                    `;
                    reportsTableBody.appendChild(row);
                } catch (e) {
                    // If a single report rendering fails, log and continue with others
                    console.error('Error rendering report row', e, report);
                }
            });
        } catch (error) {
            showError(error.message);
        }
    }

    function showReports() {
        reportsModal.style.display = 'flex'; // Show the modal overlay
        setTimeout(() => { reportsModal.style.opacity = '1'; }, 10); // Fade in
        loadReports(); // Load reports when showing the table
    }

    function hideReports() {
        reportsModal.style.opacity = '0'; // Fade out
        setTimeout(() => {
            reportsModal.style.display = 'none'; // Hide after transition
            reportsTableBody.innerHTML = ''; // Clear the table content when hiding
        }, 300); // Match CSS transition duration
    }
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.add('show');

        setTimeout(() => {
            errorMessage.classList.remove('show');
        }, 3000); // Hide after 3 seconds
    }

    function showSuccess(message) {
        const successEl = document.getElementById('success-message');
        if (!successEl) {
            alert(message);
            return;
        }
        successEl.textContent = message;
        successEl.style.display = 'block';
        // Auto-hide after 3 seconds
        setTimeout(() => { successEl.style.display = 'none'; }, 3000);
    }
});
