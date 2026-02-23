document.addEventListener('DOMContentLoaded', () => {
    // Only allow superadmins
    const role = localStorage.getItem('userRole');
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');

    // Extended debug - show full auth state
    console.log('Superadmin dashboard load - Auth state:', {
        role: role,
        token: token ? `${token.slice(0,12)}...` : null,
        localStorage: {
            token: !!localStorage.getItem('token'),
            authToken: !!localStorage.getItem('authToken'),
            userRole: localStorage.getItem('userRole'),
            username: localStorage.getItem('username')
        },
        url: window.location.href
    });

    if (role !== 'superadmin') {
        alert('Access denied. Superadmin only.');
        window.location.href = 'login.html';
        return;
    }

    if (!token) {
        // If role exists but token is missing, instruct user to log in again.
        alert('Session token missing. Please log in again.');
        window.location.href = 'login.html';
        return;
    }

    const backBtn = document.getElementById('backToAdminBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const saReportsModal = document.getElementById('saReportsModal');
    const saReportsTableBody = document.querySelector('#saReportsTable tbody');
    const closeSaReportsModal = document.getElementById('closeSaReportsModal');
    const saReportDetailsModal = document.getElementById('saReportDetailsModal');
    const closeSaReportDetailsModal = document.getElementById('closeSaReportDetailsModal');
    const saReportDetailsBody = document.getElementById('saReportDetailsBody');
    const saUsersTableBody = document.querySelector('#saUsersTable tbody');
    const saUsersModal = document.getElementById('saUsersModal');
    const closeSaUsersModal = document.getElementById('closeSaUsersModal');
    const saUsersModalTableBody = document.querySelector('#saUsersModalTable tbody');
    const saFilterRole = document.getElementById('saFilterRole');
    const saRefreshBtn = document.getElementById('saRefreshBtn');
    const saRegisterForm = document.getElementById('saRegisterForm');
    const saRegisterMessage = document.getElementById('saRegisterMessage');
    const saUserFields = document.getElementById('saUserFields');
    const saConfirmPassword = document.getElementById('saConfirmPassword');

    backBtn.addEventListener('click', () => {
        // When switching to admin view from superadmin, hide register buttons on admin page
        try { localStorage.setItem('hideRegisterButtons', '1'); } catch (e) {}
        window.location.href = 'admin_dashboard.html';
    });
   

    // --- Development helper: auto-open reports modal when debug flag set ---
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const debugFlag = urlParams.get('debug_modal') === '1' || localStorage.getItem('debugModal') === '1';
        if (debugFlag) {
            console.info('Debug: auto-opening reports modal (debug_modal=1)');
            if (saReportsModal) {
                // attempt to open using the robust method used above
                if (saReportsModal.classList.contains('modal-overlay')) {
                    saReportsModal.classList.add('show');
                } else if (saReportsModal.classList.contains('modal')) {
                    saReportsModal.style.display = 'flex';
                    saReportsModal.classList.add('active');
                } else {
                    saReportsModal.style.display = 'flex';
                }
                saReportsModal.removeAttribute('aria-hidden');
                saReportsModal.style.zIndex = '12000';
                document.body.style.overflow = 'hidden';

                // log computed style to help diagnose hidden visibility
                try {
                    const cs = window.getComputedStyle(saReportsModal);
                    console.info('Debug modal computed style:', { display: cs.display, visibility: cs.visibility, opacity: cs.opacity });
                } catch (e) {
                    console.warn('Debug: failed to read computed style for modal', e);
                }
            } else {
                console.warn('Debug: saReportsModal element not found');
            }
            // load reports for debugging view
            loadReports().catch(e => console.warn('Debug: loadReports failed', e));
        }
    } catch (e) {
        console.warn('Debug modal helper failed', e);
    }
    if (closeSaReportsModal) closeSaReportsModal.addEventListener('click', () => { 
        if (saReportsModal) { 
            if (saReportsModal.classList.contains('modal-overlay')) {
                saReportsModal.classList.remove('show');
            } else if (saReportsModal.classList.contains('modal')) {
                saReportsModal.classList.remove('active');
                saReportsModal.style.display = '';
            } else {
                saReportsModal.style.display = '';
            }
            saReportsModal.setAttribute('aria-hidden','true');
            saReportsModal.style.zIndex = '';
            document.body.style.overflow = ''; 
        } 
    });
    if (closeSaReportDetailsModal) closeSaReportDetailsModal.addEventListener('click', () => { 
        if (saReportDetailsModal) { 
            if (saReportDetailsModal.classList.contains('modal-overlay')) {
                saReportDetailsModal.classList.remove('show');
            } else if (saReportDetailsModal.classList.contains('modal')) {
                saReportDetailsModal.classList.remove('active');
                saReportDetailsModal.style.display = '';
            } else {
                saReportDetailsModal.style.display = '';
            }
            saReportDetailsModal.setAttribute('aria-hidden','true');
            saReportDetailsModal.style.zIndex = '';
            document.body.style.overflow = ''; 
        } 
    });
    logoutBtn.addEventListener('click', () => {
        localStorage.clear();
        window.location.href = 'login.html';
    });

    async function loadUsers() {
        // allow role override when a role card is clicked
        const roleFilter = arguments.length && arguments[0] ? arguments[0] : saFilterRole.value;
        const params = new URLSearchParams();
        if (roleFilter) params.append('role', roleFilter);
        try {
            console.debug('Loading users with role filter:', roleFilter, 'query:', params.toString());
            const data = await fetchAPI(`/admin/users?${params.toString()}`);
            const users = (data && data.users) ? data.users : (Array.isArray(data) ? data : []);
            saUsersTableBody.innerHTML = '';
            if (!users || users.length === 0) {
                saUsersTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:12px;">No users found</td></tr>';
                return;
            }
            // show the users list container
            const usersListContainer = document.getElementById('saUsersListContainer');
            if (usersListContainer) usersListContainer.style.display = '';
            users.forEach(u => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(u.username || '')}</td>
                    <td>${escapeHtml(u.email || '')}</td>
                    <td>${escapeHtml(u.role || '')}</td>
                    <td>
                        <button class="btn btn-danger sa-delete-btn" data-user-id="${escapeHtml(u.id || u._id || '')}">Delete</button>
                    </td>
                `;
                saUsersTableBody.appendChild(tr);
            });

            // attach delete handlers
            document.querySelectorAll('.sa-delete-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.currentTarget.getAttribute('data-user-id');
                    if (!id) return;
                    if (!confirm('Delete this user? This cannot be undone.')) return;
                    try {
                        await fetchAPI(`/admin/users/${id}`, { method: 'DELETE' });
                        await loadUsers();
                    } catch (err) {
                        saRegisterMessage.textContent = err.message || 'Failed to delete user';
                        saRegisterMessage.className = 'alert alert-error';
                    }
                });
            });
        } catch (err) {
            saUsersTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: #c00;">${escapeHtml(err.message || 'Failed to load users')}</td></tr>`;
        }
    }

    // --- Reports (read-only) for superadmin ---
    async function loadReports() {
        try {
            if (!saReportsTableBody) {
                console.warn('saReportsTableBody not found in DOM');
            } else {
                saReportsTableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading reports...</td></tr>';
            }
            const data = await fetchAPI('/admin/reports');
            const items = (data && data.items) ? data.items : (Array.isArray(data) ? data : []);
            if (saReportsTableBody) saReportsTableBody.innerHTML = '';
            if (!items || items.length === 0) {
                if (saReportsTableBody) saReportsTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:12px;">No reports found</td></tr>';
                return;
            }
            items.forEach(it => {
                const tr = document.createElement('tr');
                const created = it.created_at ? new Date(it.created_at).toLocaleString() : '';
                tr.innerHTML = `
                    <td>${escapeHtml(it.title || '')}</td>
                    <td>${escapeHtml(it.reporter_username || '')}<br><small>${escapeHtml(it.reporter_email || '')}</small></td>
                    <td>${escapeHtml(it.status || '')}</td>
                    <td>${escapeHtml(it.severity || '')}</td>
                    <td>${escapeHtml(created)}</td>
                    <td class="report-actions">
                        <button class="btn btn-primary sa-view-report" data-id="${escapeHtml(it.report_id)}">View</button>
                        <button class="btn btn-danger sa-delete-report" data-id="${escapeHtml(it.report_id)}" title="Delete report">Delete</button>
                    </td>
                `;
                if (saReportsTableBody) saReportsTableBody.appendChild(tr);
            });

            // attach handlers
            document.querySelectorAll('.sa-view-report').forEach(btn => btn.removeEventListener && btn.removeEventListener('click', () => {}));
            document.querySelectorAll('.sa-view-report').forEach(btn => btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                if (!id) return;
                try {
                    // Backend returns { report: {...}, assignments: [...] }
                    const resp = await fetchAPI(`/admin/reports/${id}`);
                    const detail = (resp && (resp.report || resp)) || {};
                    // Prefer assignments returned with the top-level response, then detail.assignments
                    let assignments = (resp && resp.assignments) || detail.assignments || null;
                    // Fallback to the dedicated history endpoint if assignments not present
                    if (!assignments) {
                        try {
                            const histResp = await fetchAPI(`/admin/assignments/${id}/history`);
                            assignments = (histResp && histResp.assignments) ? histResp.assignments : [];
                        } catch (e) {
                            console.warn('Failed to fetch assignments history fallback:', e);
                            assignments = [];
                        }
                    }

                    // Only show report title, status, severity and details in the modal.
                    saReportDetailsBody.innerHTML = `
                        <p><strong>Title:</strong> ${escapeHtml(detail.title || '')}</p>
                        <p><strong>Status:</strong> ${escapeHtml(detail.status || '')}</p>
                        <p><strong>Severity:</strong> ${escapeHtml(detail.severity || '')}</p>
                        <p><strong>Details:</strong></p>
                        <div style="white-space:pre-wrap; border:1px solid #eee; padding:8px; margin-bottom:16px;">${escapeHtml(detail.details || detail.detail || '')}</div>
                    `;
                    if (saReportDetailsModal) {
                        // ensure details modal appears above the reports modal
                        saReportDetailsModal.style.display = 'flex';
                        saReportDetailsModal.classList.add('active');
                        saReportDetailsModal.style.zIndex = '13000';
                        saReportDetailsModal.removeAttribute('aria-hidden');
                        document.body.style.overflow = 'hidden';
                    }
                } catch (err) {
                    alert(err.message || 'Failed to load report details');
                }
            }));

            document.querySelectorAll('.sa-delete-report').forEach(btn => btn.removeEventListener && btn.removeEventListener('click', () => {}));
            document.querySelectorAll('.sa-delete-report').forEach(btn => btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                if (!id) return;
                if (!confirm('Delete this report? This will remove it permanently. Continue?')) return;
                try {
                    await fetchAPI(`/admin/reports/${id}`, { method: 'DELETE' });
                    await loadReports();
                    // Refresh the report stat cards so counts update immediately after deletion
                    try { await loadReportsCard(); } catch (e) { console.warn('Failed to refresh report cards after delete', e); }
                } catch (err) {
                    alert(err.message || 'Failed to delete report');
                }
            }));

        } catch (err) {
            console.error('Failed to load reports for superadmin:', err);
            saReportsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#c00;">${escapeHtml(err.message || 'Failed to load reports')}</td></tr>`;
        }
    }

    // load counts for users and render role cards
    async function loadUserCounts() {
        try {
            const data = await fetchAPI('/admin/users');
            const users = (data && data.users) ? data.users : [];
            const counts = { superadmin:0, admin:0, auditor:0, reporter:0 };
            users.forEach(u => {
                const r = (u.role || '').toLowerCase();
                if (counts.hasOwnProperty(r)) counts[r]++;
            });
            renderRoleCards(counts);
        } catch (e) {
            console.warn('Failed to load user counts', e);
// If the counts fail to load (network or auth), still render role cards so the superadmin can interact with the UI and open the role modal.
            try {
                renderRoleCards({ superadmin:0, admin:0, auditor:0, reporter:0 });
            } catch (er) {
                console.error('Failed to render fallback role cards', er);
            }
        }
    }

    function renderRoleCards(counts) {
        const container = document.getElementById('roleCards');
        if (!container) return;
        container.innerHTML = '';
        const roles = [
            { key: 'superadmin', label: 'Superadmins' },
            { key: 'admin', label: 'Admins' },
            { key: 'auditor', label: 'Auditors' },
            { key: 'reporter', label: 'Reporters' }
        ];
        roles.forEach(r => {
            const card = document.createElement('div');
            card.className = 'card-stats';
            card.innerHTML = `<button class="btn btn-card" data-role="${r.key}">${r.label}<br><span class="stat-number">${counts[r.key] || 0}</span></button>`;
            container.appendChild(card);
            const btn = card.querySelector('button');
            btn.addEventListener('click', () => {
                // open modal and show users for this role
                loadUsersModal(r.key);
            });
        });
    }

    // Load users for role and populate the users modal
    async function loadUsersModal(roleFilter) {
        try {
            console.debug('loadUsersModal start', { roleFilter, saUsersModalExists: !!saUsersModal, tableBodyExists: !!saUsersModalTableBody });

            // Open modal immediately with loading state so user sees progress even if fetch slow/fails
            if (saUsersModal) {
                saUsersModal.style.display = 'flex';
                saUsersModal.classList.add('active');
                saUsersModal.removeAttribute('aria-hidden');
                saUsersModal.style.zIndex = '12500';
                saUsersModal.style.opacity = '1';
                saUsersModal.style.visibility = 'visible';
                document.body.style.overflow = 'hidden';
            }

            if (saUsersModalTableBody) {
                saUsersModalTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:12px;">Loading users...</td></tr>';
            }

            const params = new URLSearchParams();
            if (roleFilter) params.append('role', roleFilter);
            const data = await fetchAPI(`/admin/users?${params.toString()}`);
            const users = (data && data.users) ? data.users : (Array.isArray(data) ? data : []);

            if (!users || users.length === 0) {
                if (saUsersModalTableBody) saUsersModalTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:12px;">No users found</td></tr>';
            } else {
                if (saUsersModalTableBody) saUsersModalTableBody.innerHTML = '';
                users.forEach(u => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${escapeHtml(u.username || '')}</td>
                        <td>${escapeHtml(u.email || '')}</td>
                        <td>${escapeHtml(u.role || '')}</td>
                        <td>
                            <button class="btn btn-danger sa-delete-modal-btn" data-user-id="${escapeHtml(u.id || u._id || '')}">Delete</button>
                        </td>
                    `;
                    saUsersModalTableBody.appendChild(tr);
                });

                // attach delete handlers inside modal
                document.querySelectorAll('.sa-delete-modal-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const id = e.currentTarget.getAttribute('data-user-id');
                        if (!id) return;
                        if (!confirm('Delete this user? This cannot be undone.')) return;
                        try {
                            await fetchAPI(`/admin/users/${id}`, { method: 'DELETE' });
                            // refresh counts and modal list
                            await loadUserCounts();
                            await loadUsersModal(roleFilter);
                        } catch (err) {
                            alert(err.message || 'Failed to delete user');
                        }
                    });
                });
            }

            // ensure modal is visible (again) after data applied
            if (saUsersModal) {
                saUsersModal.style.display = 'flex';
                saUsersModal.classList.add('active');
                saUsersModal.removeAttribute('aria-hidden');
                saUsersModal.style.zIndex = '12500';
                saUsersModal.style.opacity = '1';
                saUsersModal.style.visibility = 'visible';
                document.body.style.overflow = 'hidden';
            }

            // set title
            const title = document.getElementById('saUsersModalTitle');
            if (title) title.textContent = `${roleFilter.charAt(0).toUpperCase() + roleFilter.slice(1)}s`;

            // add background click handler to close when clicking outside modal-content
            if (saUsersModal) {
                const onBgClick = (e) => {
                    if (e.target === saUsersModal) {
                        saUsersModal.classList.remove('active');
                        saUsersModal.style.display = '';
                        saUsersModal.setAttribute('aria-hidden','true');
                        document.body.style.overflow = '';
                        saUsersModal.removeEventListener('click', onBgClick);
                        window.removeEventListener('keydown', escHandler);
                    }
                };
                saUsersModal.addEventListener('click', onBgClick);
            }

            // ESC key closes modal
            const escHandler = (e) => {
                if (e.key === 'Escape' && saUsersModal && saUsersModal.classList.contains('active')) {
                    saUsersModal.classList.remove('active');
                    saUsersModal.style.display = '';
                    saUsersModal.setAttribute('aria-hidden','true');
                    document.body.style.overflow = '';
                    window.removeEventListener('keydown', escHandler);
                }
            };
            window.addEventListener('keydown', escHandler);
        } catch (err) {
            console.error('loadUsersModal error', err);
            if (saUsersModalTableBody) saUsersModalTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#c00;">${escapeHtml(err.message || 'Failed to load users')}</td></tr>`;
        }
    }

    async function loadReportsCard() {
        try {
            // Fetch aggregated stats for the superadmin dashboard
            const stats = await fetchAPI('/admin/reports/stats');
            if (!stats) {
                console.warn('loadReportsCard: no stats returned');
                return;
            }
            console.debug('loadReportsCard: stats=', stats);

            function safeSet(id, value) {
                try {
                    const el = document.getElementById(id);
                    if (el) el.textContent = (value != null ? value : 0);
                } catch (e) {
                    console.warn('safeSet failed for', id, e);
                }
            }

            // Total
            safeSet('reportsCount', stats.total_reports || 0);

            // Resolved / Pending / Open
            safeSet('resolvedReports', stats.resolved_reports || 0);
            safeSet('pendingReports', stats.pending_reports || 0);
            safeSet('openReports', stats.open_reports || 0);

            // Severity snapshot
            const snap = stats.severity_snapshot || {};
            safeSet('resolvedCritical', (snap.critical && snap.critical.resolved) || 0);
            safeSet('resolvedHigh', (snap.high && snap.high.resolved) || 0);
            safeSet('resolvedMedium', (snap.medium && snap.medium.resolved) || 0);
            safeSet('resolvedLow', (snap.low && snap.low.resolved) || 0);

            safeSet('openCritical', (snap.critical && snap.critical.open) || 0);
            safeSet('openHigh', (snap.high && snap.high.open) || 0);
            safeSet('openMedium', (snap.medium && snap.medium.open) || 0);
            safeSet('openLow', (snap.low && snap.low.open) || 0);

            safeSet('pendingCritical', (snap.critical && snap.critical.pending) || 0);
            safeSet('pendingHigh', (snap.high && snap.high.pending) || 0);
            safeSet('pendingMedium', (snap.medium && snap.medium.pending) || 0);
            safeSet('pendingLow', (snap.low && snap.low.pending) || 0);

            // Keep Total card opening the reports modal
            const reportsBtn = document.getElementById('reportsCardBtn');
            if (reportsBtn) reportsBtn.addEventListener('click', async () => {
                try {
                    if (saReportsModal) {
                        if (saReportsModal.classList.contains('modal-overlay')) {
                            saReportsModal.classList.add('show');
                        } else if (saReportsModal.classList.contains('modal')) {
                            saReportsModal.style.display = 'flex';
                            saReportsModal.classList.add('active');
                        } else {
                            saReportsModal.style.display = 'flex';
                        }
                        saReportsModal.removeAttribute('aria-hidden');
                        saReportsModal.style.zIndex = '12000';
                        document.body.style.overflow = 'hidden';
                    }
                    await loadReports();
                } catch (e) {
                    console.error('Failed to open reports modal', e);
                }
            });
        } catch (e) {
            console.warn('Failed to load reports count', e);
        }
    }

    saRefreshBtn.addEventListener('click', loadUsers);
    saFilterRole.addEventListener('change', loadUsers);

    if (closeSaUsersModal) closeSaUsersModal.addEventListener('click', () => {
        if (saUsersModal) {
            if (saUsersModal.classList.contains('modal-overlay')) {
                saUsersModal.classList.remove('show');
            } else if (saUsersModal.classList.contains('modal')) {
                saUsersModal.classList.remove('active');
                saUsersModal.style.display = '';
            } else {
                saUsersModal.style.display = '';
            }
            saUsersModal.setAttribute('aria-hidden','true');
            document.body.style.overflow = '';
        }
    });

    // Reveal user input fields only after a role is selected
    const saRoleEl = document.getElementById('saRole');
    if (saRoleEl && saUserFields) {
        saRoleEl.addEventListener('change', (ev) => {
            if (saRoleEl.value && saRoleEl.value.trim() !== '') {
                saUserFields.style.display = '';
                // focus username for convenience
                const u = document.getElementById('saUsername');
                if (u) u.focus();
                // Show department field only for reporters
                const deptGroup = document.getElementById('saDepartmentGroup');
                if (deptGroup) {
                    if (saRoleEl.value === 'reporter') deptGroup.style.display = '';
                    else deptGroup.style.display = 'none';
                }
            } else {
                saUserFields.style.display = 'none';
            }
        });
    }

    // Register form submit handler
    if (saRegisterForm) {
        saRegisterForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            saRegisterMessage.textContent = '';
            saRegisterMessage.className = '';
            const username = (document.getElementById('saUsername') && document.getElementById('saUsername').value) ? document.getElementById('saUsername').value.trim() : '';
            const email = (document.getElementById('saEmail') && document.getElementById('saEmail').value) ? document.getElementById('saEmail').value.trim() : '';
            const password = (document.getElementById('saPassword') && document.getElementById('saPassword').value) ? document.getElementById('saPassword').value : '';
            const role = (document.getElementById('saRole') && document.getElementById('saRole').value) ? document.getElementById('saRole').value : '';
            const confirmPass = (document.getElementById('saConfirmPassword') && document.getElementById('saConfirmPassword').value) ? document.getElementById('saConfirmPassword').value : '';

            if (!role || role.trim() === '') { alert('Please select a role to register'); return; }
            if (!username || !email || !password || !confirmPass) { alert('Please fill required fields'); return; }
            if (password !== confirmPass) { alert('Passwords do not match'); return; }

            try {
                const departmentEl = document.getElementById('saDepartment');
                const department = departmentEl ? departmentEl.value.trim() : undefined;
                const payload = { username, email, password, role };
                if (role === 'reporter' && department) payload.department = department;
                showProcessing('Processing, please wait...');
                try {
                    const result = await fetchAPI('/admin/users', { method: 'POST', body: JSON.stringify(payload), showProcessing: false });
                    try { hideProcessing(); } catch (e) {}
                    try { if (typeof window.showSuccess === 'function') window.showSuccess(result.message || 'User created'); else alert(result.message || 'User created'); } catch (e) { alert(result.message || 'User created'); }
                    saRegisterForm.reset();
                    await loadUserCounts();
                } catch (err) {
                    try { hideProcessing(); } catch (e) {}
                    throw err;
                }
            } catch (err) {
                try { if (typeof window.showError === 'function') window.showError(err.message || 'Failed to create user'); else alert(err.message || 'Failed to create user'); } catch (e) { alert(err.message || 'Failed to create user'); }
            }
        });
    }

    // initial load: only counts and report cards (users list opened from role cards)
    loadUserCounts();
    loadReportsCard();

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
});
