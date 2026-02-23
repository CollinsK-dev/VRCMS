document.addEventListener('DOMContentLoaded', () => {
    const userInfo = document.getElementById('user-info');
    const logoutBtn = document.getElementById('logoutBtn');
    const allReportsTableBody = document.querySelector('#allReportsTable tbody');
    const errorMessage = document.getElementById('error-message');
    const assignmentsModal = document.getElementById('assignmentsModal');
    const viewAssignmentsBtn = document.getElementById('viewAssignmentsBtn');
    const viewFeedbacksBtn = document.getElementById('viewFeedbacksBtn');
    const applyFilterBtn = document.getElementById('applyFilterBtn');
    const filterReporterBtn = document.getElementById('filterReporterBtn');
    const filterSeveritySelect = document.getElementById('filterSeveritySelect');
    const reporterFilterModal = document.getElementById('reporterFilterModal');
    const filteredResultsModal = document.getElementById('filteredResultsModal');
    const filteredResultsTableBody = document.querySelector('#filteredResultsTable tbody');

    // Stored reporter filter criteria
    let filterReporterName = '';
    let filterReporterEmail = '';
    
    // Ensure modal exists
    if (!assignmentsModal) {
        console.error('Assignments modal not found in the DOM');
    }

    // Helper: attach backdrop click-to-close behavior for static modal elements
    function attachBackdropClose(modalEl) {
        if (!modalEl) return;
        // avoid duplicate handlers
        if (modalEl.dataset.backdropAttached) return;
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) {
                // clicking the backdrop: hide modal and restore scrolling
                try { modalEl.style.display = 'none'; } catch (err) { /* ignore */ }
                try { document.body.style.overflow = ''; } catch (err) { /* ignore */ }
            }
        });
        modalEl.dataset.backdropAttached = '1';
    }

    // Enable clicking outside to close for static modals present on the page
    attachBackdropClose(assignmentsModal);
    attachBackdropClose(reporterFilterModal);
    attachBackdropClose(filteredResultsModal);

    // Show assignee feedback modal for a report
    async function showAssigneeFeedbackModal(reportId) {
        try {
            const resp = await fetchAPI(`/admin/reports/${reportId}/feedback`);
            const feedback = (resp && resp.feedback) || [];

            const existing = document.querySelector('.assignee-feedback-overlay');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.className = 'assignee-feedback-overlay';
            Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', right: '0', bottom: '0', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '10000' });

            const modal = document.createElement('div');
            Object.assign(modal.style, { background: '#fff', padding: '20px', borderRadius: '6px', maxWidth: '800px', width: '95%', maxHeight: '80vh', overflowY: 'auto' });

            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '&times;';
            Object.assign(closeBtn.style, { float: 'right', border: 'none', background: 'none', fontSize: '24px', cursor: 'pointer' });
            closeBtn.onclick = () => overlay.remove();
            modal.appendChild(closeBtn);

            const h = document.createElement('h3');
            h.textContent = 'Assignee Feedback';
            modal.appendChild(h);

            if (!feedback.length) {
                const p = document.createElement('p');
                p.textContent = 'No feedback recorded for this report yet.';
                modal.appendChild(p);
            } else {
                feedback.forEach(f => {
                    const card = document.createElement('div');
                    card.style.borderLeft = '3px solid #ccc';
                    card.style.paddingLeft = '10px';
                    card.style.margin = '8px 0';
                    const at = f.feedback_at ? new Date(f.feedback_at).toLocaleString() : 'Unknown time';
                    card.innerHTML = `<strong>${escapeHtml(f.assignee_name || f.assignee_email)}</strong> <br/><small>${escapeHtml(at)}</small><pre style="white-space:pre-wrap;">${escapeHtml(f.feedback_text || '')}</pre>`;
                    modal.appendChild(card);
                });
            }

            overlay.appendChild(modal);
            // allow clicking outside modal content to close this overlay
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
            document.body.appendChild(overlay);
        } catch (err) {
            console.error('Failed to fetch assignee feedback:', err);
            showError('Failed to load feedback');
        }
    }

    // Show resolve modal for admin to enter steps and mark the report resolved
    async function showResolveModal(reportId, opts = {}) {
        // Remove any existing overlay
        const existing = document.querySelector('.resolve-overlay');
        if (existing) existing.remove();

    // Use system modal classes to match styling
    const overlay = document.createElement('div');
    overlay.className = 'modal modal-overlay show resolve-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-content';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = () => overlay.remove();
    modal.appendChild(closeBtn);
    // allow clicking backdrop to close resolve modal
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const h = document.createElement('h3');
        h.textContent = 'Mark Report Resolved';
        modal.appendChild(h);

        // Fetch report metadata (title) to show beside the report id in the modal
        try {
            const reportResp = await fetchAPI(`/admin/reports/${reportId}`);
            const reportObj = (reportResp && reportResp.report) || (reportResp && reportResp.items && reportResp.items[0]) || null;
            const meta = document.createElement('div');
            meta.className = 'resolve-report-meta';
            meta.style.margin = '6px 0 12px';
            const titleText = reportObj && (reportObj.title || reportObj.report && reportObj.report.title) ? (reportObj.title || (reportObj.report && reportObj.report.title)) : 'Untitled';
            meta.innerHTML = `<strong>Report:</strong> ${escapeHtml(titleText)} <small style="color:#666;margin-left:8px;">(${escapeHtml(reportId)})</small>`;
            modal.appendChild(meta);
        } catch (e) {
            // If fetching metadata fails, still show the id
            const meta = document.createElement('div');
            meta.className = 'resolve-report-meta';
            meta.style.margin = '6px 0 12px';
            meta.innerHTML = `<small style="color:#666;">(${escapeHtml(reportId)})</small>`;
            modal.appendChild(meta);
        }

        // Attempt to fetch assignment history for this report to populate assignee dropdown
        let assignees = [];
        try {
            const histResp = await fetchAPI(`/admin/assignments/${reportId}/history`);
            const list = (histResp && histResp.assignments) || [];
            // list is oldest->newest; iterate from newest to oldest and build unique list
            const seen = new Set();
            for (let i = list.length - 1; i >= 0; i--) {
                const a = list[i];
                const key = (a.assignee_email || a.assignee_name || '').toLowerCase();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                assignees.push({ name: a.assignee_name || a.assignee_username || 'Unknown', email: a.assignee_email || '' });
            }
        } catch (err) {
            console.warn('Failed to fetch assignment history for resolve modal:', err);
            assignees = [];
        }

        // Build assignee select group
        const assigneeGroup = document.createElement('div');
        assigneeGroup.className = 'form-group';
        const assigneeLabel = document.createElement('label');
        assigneeLabel.setAttribute('for', 'resolveAssigneeSelect');
        assigneeLabel.textContent = 'Select Assignee (who performed the work)';
        assigneeGroup.appendChild(assigneeLabel);
        const select = document.createElement('select');
        select.id = 'resolveAssigneeSelect';
        select.className = 'input';
        Object.assign(select.style, { width: '100%' });
        if (assignees.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No assignees found';
            select.appendChild(opt);
            select.disabled = true;
        } else {
            assignees.forEach((a, idx) => {
                const opt = document.createElement('option');
                opt.value = String(idx);
                opt.textContent = `${a.name}${a.email ? ` <${a.email}>` : ''}`;
                select.appendChild(opt);
            });
        }
        assigneeGroup.appendChild(select);
    // Container to show feedbacks for the selected assignee
    const feedbackContainer = document.createElement('div');
    feedbackContainer.id = 'assigneeFeedbackContainer';
    feedbackContainer.style.marginTop = '12px';
    modal.appendChild(feedbackContainer);
        modal.appendChild(assigneeGroup);

        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';
        const label = document.createElement('label');
        label.setAttribute('for', 'resolveSteps');
        label.textContent = 'Steps Taken to Resolve';
        formGroup.appendChild(label);
        const textarea = document.createElement('textarea');
        textarea.id = 'resolveSteps';
        textarea.className = 'input';
        textarea.placeholder = 'Describe the steps taken to resolve the report';
        Object.assign(textarea.style, { width: '100%', minHeight: '120px' });
        formGroup.appendChild(textarea);
        modal.appendChild(formGroup);

        const actionsDiv = document.createElement('div');
        Object.assign(actionsDiv.style, { marginTop: '12px', textAlign: 'right', display: 'flex', gap: '8px', justifyContent: 'flex-end' });
        const submitBtn = document.createElement('button');
        submitBtn.id = 'submitResolveBtn';
        submitBtn.className = 'btn btn-primary';
        submitBtn.textContent = 'Submit & Mark Resolved';
    const cancelBtn2 = document.createElement('button');
    cancelBtn2.id = 'cancelResolveBtn';
    cancelBtn2.className = 'btn btn-secondary';
    cancelBtn2.textContent = 'Cancel';
    cancelBtn2.onclick = () => overlay.remove();
        actionsDiv.appendChild(submitBtn);
        actionsDiv.appendChild(cancelBtn2);
        modal.appendChild(actionsDiv);

    overlay.appendChild(modal);
    // allow clicking backdrop to close the all-feedbacks overlay
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

        submitBtn.addEventListener('click', async () => {
            const steps = textarea.value.trim();
            if (!steps) { showError('Please enter the steps taken to resolve'); return; }
            // Confirm action with the admin before proceeding
            const confirmed = window.confirm('Submit and mark this report as resolved? This action cannot be undone. Continue?');
            if (!confirmed) return;
            // Determine selected assignee (if any)
            let payload = { resolve_steps: steps };
            try {
                const selectEl = document.getElementById('resolveAssigneeSelect');
                if (selectEl && !selectEl.disabled) {
                    const idx = selectEl.value;
                    if (idx !== '') {
                        const selected = assignees[Number(idx)];
                        if (selected) {
                            payload.assignee_name = selected.name;
                            payload.assignee_email = selected.email || '';
                        }
                    }
                }

                // Show an explicit 'Please wait...' overlay immediately after the admin confirms.
                showProcessing('Please wait...');
                try {
                    const result = await fetchAPI(`/admin/reports/${reportId}/resolve`, {
                        method: 'POST',
                        body: JSON.stringify(payload),
                        showProcessing: false
                    });

                    // If the API returned an object with message, show it; otherwise generic success
                    console.log('resolve API result:', result);
                    const msg = (result && result.message) ? result.message : 'Report marked as Resolved and admins notified';
                    showSuccess(msg);
                    // Close overlay only on success
                    overlay.remove();

                    // Immediately update the UI: replace any Resolve button for this report with a Report Details button
                    try {
                        // Find resolve button(s) that reference this report id and swap them
                        const selector = `[data-report-id="${reportId}"]`;
                        document.querySelectorAll(selector).forEach(el => {
                            // Only replace actual resolve buttons (avoid touching other button types)
                            if (el.classList && el.classList.contains('resolve-btn')) {
                                const detailsBtn = document.createElement('button');
                                detailsBtn.className = 'btn btn-info details-btn';
                                detailsBtn.textContent = 'Report Details';
                                // preserve the same data-report-id so event handlers can use it
                                detailsBtn.setAttribute('data-report-id', reportId);
                                // attach click handler directly for immediate behavior
                                detailsBtn.addEventListener('click', (ev) => {
                                    ev.preventDefault();
                                    handleShowReportDetails(reportId);
                                });
                                // Replace in DOM
                                try { el.replaceWith(detailsBtn); } catch (e) { console.warn('Failed to replace resolve button in-place', e); }
                            }
                        });
                    } catch (e) { console.warn('Failed to update resolve button to details button:', e); }

                    // Refresh both assignments and main reports in background to ensure state is consistent
                    loadAssignments().catch(() => {});
                    loadAllReports().catch(() => {});
                } finally {
                    // Ensure overlay is hidden regardless of success/failure
                    try { hideProcessing(); } catch (e) { /* swallow */ }
                }
            } catch (err) {
                console.error('Failed to mark resolved:', err);
                // If the error contains a server message, display it to help debugging
                try {
                    if (err && err.message) {
                        showError('Failed to mark report as resolved: ' + err.message);
                    } else {
                        showError('Failed to mark report as resolved');
                    }
                } catch (e) {
                    showError('Failed to mark report as Resolved');
                }
            }
        });

        // When an assignee is selected, fetch their feedback entries and show them below
        select.addEventListener('change', async () => {
            const idx = select.value;
            const container = document.getElementById('assigneeFeedbackContainer');
            container.innerHTML = '';
            if (idx === '' || assignees.length === 0) return;
            const selected = assignees[Number(idx)];
            if (!selected) return;
            try {
                const resp = await fetchAPI(`/admin/reports/${reportId}/feedback`);
                const feedbacks = (resp && resp.feedback) || [];
                console.debug('Fetched feedbacks for report', reportId, resp);
                const key = (selected.email || selected.name || '').toLowerCase();
                const matches = feedbacks.filter(f => {
                    return (f.assignee_email && f.assignee_email.toLowerCase() === key) || (f.assignee_name && f.assignee_name.toLowerCase() === key) || (selected.name && f.assignee_name && f.assignee_name.toLowerCase() === selected.name.toLowerCase());
                });
                console.debug('Assignee key:', key, 'matches found:', matches.length, matches);

                if (!matches.length) {
                    const p = document.createElement('p');
                    p.textContent = 'No feedback received from the selected assignee.';
                    container.appendChild(p);
                    // Clear textarea so admin can enter manually the steps
                    textarea.value = '';
                    return;
                }
                const list = document.createElement('div');
                list.style.display = 'flex';
                list.style.flexDirection = 'column';
                list.style.gap = '8px';
                matches.forEach(f => {
                    const card = document.createElement('div');
                    card.style.borderLeft = '3px solid #ccc';
                    card.style.paddingLeft = '10px';
                    card.style.margin = '4px 0';
                    const at = f.feedback_at ? new Date(f.feedback_at).toLocaleString() : 'Unknown time';
                    // Display only the date/time for each feedback entry per request.
                    card.innerHTML = `<small>${escapeHtml(at)}</small>`;
                    list.appendChild(card);
                });
                container.appendChild(list);

                // Prefill textarea with the most recent feedback_text by this assignee so admin can submit/adjust it
                const mostRecent = matches[0];
                textarea.value = mostRecent.feedback_text || '';
            } catch (err) {
                console.error('Failed to load assignee feedback:', err);
                const p = document.createElement('p');
                p.textContent = 'Failed to load feedback for this assignee.';
                container.appendChild(p);
            }
        });

        // If options provided, pre-select assignee and prefill textarea / feedbacks
        if (opts) {
            try {
                // If a feedback_text is provided, prefill the textarea after listeners attached
                if (opts.assignee_email || opts.assignee_name) {
                    // find matching assignee index
                    const key = (opts.assignee_email || opts.assignee_name || '').toLowerCase();
                    let foundIdx = '';
                    for (let i = 0; i < assignees.length; i++) {
                        const a = assignees[i];
                        if (!a) continue;
                        const ak = ((a.email || a.name) || '').toLowerCase();
                        if (ak && ak === key) { foundIdx = String(i); break; }
                    }
                    if (foundIdx !== '') {
                        select.value = foundIdx;
                        // trigger change to load feedbacks into the container
                        select.dispatchEvent(new Event('change'));
                    }
                }

                if (opts.feedback_text) {
                    textarea.value = opts.feedback_text;
                }
            } catch (e) {
                console.warn('Failed to prefill resolve modal with options', e);
            }
        }
    }

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
    // Superadmin panel button (shows link to the superadmin console)
    const superadminPanelBtn = document.getElementById('superadminPanelBtn');
    const userRole = localStorage.getItem('userRole');
    if (userRole === 'superadmin' && superadminPanelBtn) {
        superadminPanelBtn.style.display = 'inline-block';
        superadminPanelBtn.addEventListener('click', () => window.location.href = 'superadmin_dashboard.html');
    }

    // --- View Assignments logic ---
    // Show assignments modal and load data
    viewAssignmentsBtn.addEventListener('click', async () => {
        try {
            if (!assignmentsModal) {
                console.error('Modal element not found');
                return;
            }

            // Clear previous content and show loading state
            const tbody = assignmentsModal.querySelector('#assignmentsTable tbody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading assignments...</td></tr>';
            }

            // Force display flex and visibility
            assignmentsModal.style.cssText = 'display: flex !important; visibility: visible !important;';
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
            
            // Ensure modal is in the viewport
            assignmentsModal.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Load assignments after modal is visible
            await loadAssignments();
        } catch (error) {
            console.error('Error loading assignments:', error);
            showError('Failed to load assignments');
            closeModal();
        }
    });

    // --- View Feedbacks Modal---
    // Fetches stored assignee feedbacks from the backend and allows promoting a feedback entry into a resolution record.
    async function showAllFeedbacksModal() {
        // Remove existing if present
        const existing = document.querySelector('.all-feedbacks-overlay');
        if (existing) existing.remove();

        // Use existing modal CSS classes 
        const overlay = document.createElement('div');
        overlay.className = 'modal modal-overlay show all-feedbacks-overlay';

        const modal = document.createElement('div');
        modal.className = 'modal-content';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.innerHTML = '&times;';
        // Declare intervalId in the outer scope of the modal so handlers can reference it without causing a ReferenceError.
        let intervalId = null;
        closeBtn.onclick = () => {
            try { if (intervalId) clearInterval(intervalId); } catch (e) { /* ignore */ }
            overlay.remove();
        };
        modal.appendChild(closeBtn);

    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.alignItems = 'center';
    headerRow.style.gap = '8px';

    // Left side: title and search box
    const leftHeader = document.createElement('div');
    leftHeader.style.display = 'flex';
    leftHeader.style.flexDirection = 'column';

    const h = document.createElement('h3');
    h.textContent = 'All Assignee Feedbacks';
    h.style.margin = '0 0 6px 0';
    leftHeader.appendChild(h);

    const searchWrap = document.createElement('div');
    searchWrap.style.display = 'flex';
    searchWrap.style.gap = '6px';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search by report title, assignee email or name...';
    searchInput.style.padding = '6px 8px';
    searchInput.style.width = '360px';
    searchInput.className = 'input';
    searchWrap.appendChild(searchInput);
    leftHeader.appendChild(searchWrap);

    headerRow.appendChild(leftHeader);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-secondary';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.style.marginLeft = '8px';
    headerRow.appendChild(refreshBtn);
    modal.appendChild(headerRow);

    const loader = document.createElement('p');
    loader.textContent = 'Loading feedbacks...';
    modal.appendChild(loader);

    // Container for feedback groups so we can re-render easily
    const groupsContainer = document.createElement('div');
    groupsContainer.id = 'allFeedbacksGroups';
    modal.appendChild(groupsContainer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

        try {
            // Fetch all feedbacks in a single call for efficiency
            async function renderFeedbacks() {
                groupsContainer.innerHTML = '';
                loader.textContent = 'Loading feedbacks...';
                try {
                    const resp = await fetchAPI('/admin/feedbacks');
                    const all = (resp && resp.feedbacks) || [];
                    loader.remove();

                    if (!all.length) {
                        const p = document.createElement('p');
                        p.textContent = 'No feedbacks found.';
                        groupsContainer.appendChild(p);
                        return;
                    }

                    // Store full list for filtering
                    let allFeedbacks = all.slice();

                    // Group feedbacks by report_id and prepare title cache
                    const groups = {};
                    allFeedbacks.forEach(f => {
                        const rid = f.report_id || 'unknown';
                        if (!groups[rid]) groups[rid] = { items: [], title: null };
                        groups[rid].items.push(f);
                    });

                    // Helper to render groups with optional filter text
                    async function renderGroups(filterText) {
                        groupsContainer.innerHTML = '';
                        const q = (filterText || '').toLowerCase().trim();
                        const rids = Object.keys(groups);
                        for (let i = 0; i < rids.length; i++) {
                            const rid = rids[i];
                            const grpObj = groups[rid];
                            const group = grpObj.items || [];
                            if (!group || group.length === 0) continue;

                            // Fetch report title if not cached
                            if (grpObj.title === null) {
                                try {
                                    const rptResp = await fetchAPI(`/admin/reports/${rid}`);
                                    const rpt = (rptResp && (rptResp.report || rptResp)) || null;
                                    grpObj.title = (rpt && (rpt.title || (rpt.report && rpt.report.title))) ? (rpt.title || (rpt.report && rpt.report.title)) : 'Untitled';
                                } catch (e) {
                                    grpObj.title = 'Untitled';
                                }
                            }

                            // Filter by report title or assignee fields when a query is present
                            if (q) {
                                const titleLower = (grpObj.title || '').toLowerCase();
                                const matchesTitle = titleLower.includes(q);
                                const matchesAnyFeedback = group.some(f => {
                                    return (f.assignee_email || '').toLowerCase().includes(q) || (f.assignee_name || '').toLowerCase().includes(q) || (String(f.report_id || '').toLowerCase().includes(q));
                                });
                                if (!matchesTitle && !matchesAnyFeedback) continue;
                            }

                            const grpDiv = document.createElement('div');
                            grpDiv.className = 'feedback-group';
                            grpDiv.style.marginBottom = '8px';
                            const titleEl = document.createElement('h4');
                            const truncated = String(rid).substring(0,8);
                            titleEl.textContent = `Report ${truncated}... — ${grpObj.title || 'Untitled'} — ${group.length} feedback(s)`;
                            grpDiv.appendChild(titleEl);

                            group.forEach(f => {
                                const card = document.createElement('div');
                                card.className = 'feedback-card';
                                card.style.margin = '8px 0';
                                const at = f.feedback_at ? new Date(f.feedback_at).toLocaleString() : 'Unknown time';
                                card.innerHTML = `<strong>${escapeHtml(f.assignee_name || f.assignee_email)}</strong> <br/><small>${escapeHtml(f.assignee_email || '')}</small> <br/><small>${escapeHtml(at)}</small>`;
                                const useBtn = document.createElement('button');
                                useBtn.className = 'btn btn-primary';
                                useBtn.style.marginTop = '6px';
                                useBtn.textContent = 'Proceed to Resolve';
                                useBtn.addEventListener('click', async () => {
                                    try { if (intervalId) clearInterval(intervalId); } catch (e) {}
                                    overlay.remove();
                                    await showResolveModal(rid, { assignee_name: f.assignee_name || '', assignee_email: f.assignee_email || '' });
                                });
                                card.appendChild(useBtn);
                                grpDiv.appendChild(card);
                            });

                            groupsContainer.appendChild(grpDiv);
                        }
                    }

                    // Initial render
                    await renderGroups('');

                    // Wire up search input with a small debounce
                    let searchTimer = null;
                    try {
                        // If searchInput exists in header, attach listener
                        if (typeof searchInput !== 'undefined' && searchInput) {
                            searchInput.addEventListener('input', () => {
                                if (searchTimer) clearTimeout(searchTimer);
                                searchTimer = setTimeout(async () => {
                                    try { await renderGroups(searchInput.value || ''); } catch (e) { console.warn('Search render failed', e); }
                                }, 250);
                            });
                        }
                    } catch (e) { /* ignore */ }
                } catch (err) {
                    console.error('Failed to load feedbacks:', err);
                    loader.textContent = 'Failed to load feedbacks.';
                }
            }

            // wire refresh 
            refreshBtn.addEventListener('click', async () => {
                await renderFeedbacks();
            });

            // initial render (only once)
            await renderFeedbacks();

        } catch (err) {
            console.error('Failed to load feedbacks:', err);
            loader.textContent = 'Failed to load feedbacks.';
        }
    }

    if (viewFeedbacksBtn) {
        viewFeedbacksBtn.addEventListener('click', async () => {
            try {
                await showAllFeedbacksModal();
            } catch (err) {
                console.error('Error showing all feedbacks:', err);
                showError('Failed to load feedbacks');
            }
        });
    }

    // Close modal when clicking the X button or outside
    const closeModal = () => {
        if (assignmentsModal) {
            assignmentsModal.style.display = 'none';
            document.body.style.overflow = '';
        }
    };

    // Handle all modal close events
    const handleModalClose = (e) => {
        if (e.target === assignmentsModal || e.target.classList.contains('modal-close')) {
            e.preventDefault();
            closeModal();
        }
    };

    // Close on X button click and outside click
    document.getElementById('closeAssignmentsModal').addEventListener('click', handleModalClose);
    assignmentsModal.addEventListener('click', handleModalClose);

    // Handle escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && assignmentsModal.style.display === 'flex') {
            closeModal();
        }
    });

    // Reporter filter modal wiring
    if (filterReporterBtn && reporterFilterModal) {
        filterReporterBtn.addEventListener('click', () => {
            // Pre-fill inputs with current criteria
            const nameInput = document.getElementById('filterReporterName');
            const emailInput = document.getElementById('filterReporterEmail');
            if (nameInput) nameInput.value = filterReporterName || '';
            if (emailInput) emailInput.value = filterReporterEmail || '';
            reporterFilterModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        });

        // Close / cancel handlers
        const closeReporterBtn = document.getElementById('closeReporterFilterModal');
        const cancelReporterBtn = document.getElementById('cancelReporterFilterBtn');
        if (closeReporterBtn) closeReporterBtn.addEventListener('click', () => {
            reporterFilterModal.style.display = 'none';
            document.body.style.overflow = '';
        });
        if (cancelReporterBtn) cancelReporterBtn.addEventListener('click', () => {
            reporterFilterModal.style.display = 'none';
            document.body.style.overflow = '';
        });

        // Apply reporter filter: store criteria and perform search immediately
        const applyReporterBtn = document.getElementById('applyReporterFilterBtn');
        if (applyReporterBtn) applyReporterBtn.addEventListener('click', async () => {
            const nameInput = document.getElementById('filterReporterName');
            const emailInput = document.getElementById('filterReporterEmail');
            filterReporterName = nameInput ? nameInput.value.trim() : '';
            filterReporterEmail = emailInput ? emailInput.value.trim() : '';
            reporterFilterModal.style.display = 'none';
            document.body.style.overflow = '';
            // Perform search and show results
            await fetchAndShowFilteredReports();
        });
    }

    // Filtered results modal close handlers
    if (filteredResultsModal) {
        const closeFilteredBtn = document.getElementById('closeFilteredResultsModal');
        const closeFilteredResultsBtn = document.getElementById('closeFilteredResultsBtn');
        if (closeFilteredBtn) closeFilteredBtn.addEventListener('click', () => {
            filteredResultsModal.style.display = 'none';
            document.body.style.overflow = '';
        });
        if (closeFilteredResultsBtn) closeFilteredResultsBtn.addEventListener('click', () => {
            filteredResultsModal.style.display = 'none';
            document.body.style.overflow = '';
        });

        // Close when clicking outside content
        filteredResultsModal.addEventListener('click', (e) => {
            if (e.target === filteredResultsModal) {
                filteredResultsModal.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    }

    // Load assignments into the modal table
    async function loadAssignments() {
        try {
            const data = await fetchAPI('/admin/assignments');
            console.log('loadAssignments: data from /admin/assignments', data);
            const assignmentsTableBody = document.querySelector('#assignmentsTable tbody');
            assignmentsTableBody.innerHTML = '';

            if (!Array.isArray(data) || data.length === 0) {
                assignmentsTableBody.innerHTML = '<tr><td colspan="5" class="text-center">No assignments found</td></tr>';
                return;
            }

            data.forEach(item => {
                const row = document.createElement('tr');
                console.log('assignment item:', {
                    report_id: item.report_id,
                    title: item.title,
                    assignee_name: item.assignee_name,
                    assignee_email: item.assignee_email,
                    severity: item.severity,
                    display_date: item.display_date,
                    is_reassignment: item.is_reassignment,
                    assignment_count: item.assignment_count
                });

                const assigneeName = item.assignee_name || 'Unassigned';
                const assigneeEmail = item.assignee_email || '';
                const severity = item.severity || 'Unknown';
                const displayDate = item.display_date ? new Date(item.display_date).toLocaleString() : 'Unknown date';
                const title = item.title || 'Untitled';
                const reporterName = item.reporter_name || item.reporter_username || 'Unknown reporter';
                const reporterEmail = item.reporter_email || (item.reporter_email === null ? 'Unknown reporter' : 'No email');
                // Only show a reassigned badge or history when there was more than one assignment for this report
                const hasMultipleAssignments = (typeof item.assignment_count === 'number' && item.assignment_count > 1);
                const reassignedBadge = hasMultipleAssignments ? `<span class="status-badge reassigned">Reassigned</span>` : '';
                // Show history button only when there's more than one assignment (initial + at least one reassignment)
                const historyBtn = hasMultipleAssignments ?
                    `<button class="btn btn-link history-btn" data-report-id="${item.report_id}">View History (${(item.assignment_count || 0) - 1})</button>` : '';

                // Build row with correct column order and data placement using DOM APIs
                const tdDetails = document.createElement('td');
                tdDetails.setAttribute('data-label', 'Report Details');
                // Show reporter name above their email
                tdDetails.innerHTML = `<strong>${escapeHtml(title)}</strong><br><small>Reporter:</small><br><strong>${escapeHtml(reporterName)}</strong><br><small>${escapeHtml(reporterEmail)}</small>`;

                const tdAssignedTo = document.createElement('td');
                tdAssignedTo.setAttribute('data-label', 'Assigned To');
                // Show assignee name with email 
                tdAssignedTo.innerHTML = `<strong>${escapeHtml(assigneeName)}</strong><br><small>${escapeHtml(assigneeEmail)}</small>`;

                const tdStatus = document.createElement('td');
                tdStatus.setAttribute('data-label', 'Status');
                const badge = document.createElement('span');
                badge.className = `status-badge ${String(severity).toLowerCase().replace(/\s+/g,'-')}`;
                badge.textContent = severity;
                tdStatus.appendChild(badge);

                const tdDate = document.createElement('td');
                tdDate.setAttribute('data-label', 'Assignment Date');
                tdDate.textContent = displayDate;

                const tdReassign = document.createElement('td');
                tdReassign.setAttribute('data-label', 'Reassignment History');
                if (reassignedBadge) {
                    const spanBadge = document.createElement('span');
                    spanBadge.className = 'status-badge reassigned';
                    spanBadge.textContent = 'Reassigned';
                    tdReassign.appendChild(spanBadge);
                }

                // Show history button when backend indicates multiple assignments
                if (hasMultipleAssignments) {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-link history-btn';
                    btn.setAttribute('data-report-id', item.report_id);
                    // This button lives inside the assignments modal — exclude the current assignment from the view
                    btn.setAttribute('data-include-current', 'false');
                    const prevCount = (typeof item.assignment_count === 'number' && item.assignment_count > 0) ? (item.assignment_count - 1) : 0;
                    btn.textContent = `View History (${prevCount})`;
                    btn.addEventListener('click', (e) => {
                        const rid = e.currentTarget.getAttribute('data-report-id');
                        const includeCurrent = e.currentTarget.getAttribute('data-include-current') !== 'false';
                        if (rid) showAssignmentHistoryModal(rid, includeCurrent);
                    });
                    tdReassign.appendChild(document.createElement('br'));
                    tdReassign.appendChild(btn);
                    console.log(`Added history button for report ${item.report_id}`);
                    try {
                        console.log('tdReassign HTML:', tdReassign.outerHTML);
                        console.log('row HTML:', row.outerHTML);
                    } catch (e) { console.log('Error logging DOM outerHTML', e); }
                }

                // Clear any existing content
                row.innerHTML = '';
                
                // Append all cells in order
                row.appendChild(tdDetails);
                row.appendChild(tdAssignedTo);
                row.appendChild(tdStatus);
                row.appendChild(tdDate);
                row.appendChild(tdReassign);
                

                // Make sure the row is visible
                row.style.display = 'table-row';
                
                assignmentsTableBody.appendChild(row);
                
                // Force a reflow to ensure the row is visible
                row.offsetHeight;

                // If no history button is present, log a debug message (no UI injection).
                try {
                    const reassignCell = row.querySelector('td[data-label="Reassignment"]');
                    if (reassignCell && !reassignCell.querySelector('.history-btn')) {
                        console.debug('No history button for report (no prior assignments):', item.report_id);
                    }
                } catch (e) { console.warn('Failed to inspect reassign cell for debug', e); }
            });

        } catch (error) {
            console.error('Error loading assignments:', error);
            showError('Failed to load assignments. Please try again later.');
            if (error.message) console.error('Error details:', error.message);
        }
    }


    // Utility: simple HTML escape to reduce XSS risk in injected table HTML
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }


    

    // Apply Filters: fetch filtered reports and show them in a modal
    applyFilterBtn.addEventListener('click', async () => {
        await fetchAndShowFilteredReports();
    });

    // Severity dropdown change: immediately apply severity filter to the main table
    if (filterSeveritySelect) {
        filterSeveritySelect.addEventListener('change', async () => {
            await loadAllReports();
        });
    }

    // Helper: fetch reports based on current date range and reporter criteria, render and show modal
    async function fetchAndShowFilteredReports() {
        try {
            const dateFrom = document.getElementById('filterDateFrom').value;
            const dateTo = document.getElementById('filterDateTo').value;

            const params = new URLSearchParams();
            if (dateFrom) params.append('date_from', dateFrom);
            if (dateTo) params.append('date_to', dateTo);
            // Include severity filter when selected
            try {
                const severity = (filterSeveritySelect && filterSeveritySelect.value) ? String(filterSeveritySelect.value).trim() : '';
                if (severity) params.append('severity', severity);
            } catch (e) { /* ignore */ }
            if (filterReporterName) params.append('reporter_name', filterReporterName);
            if (filterReporterEmail) params.append('reporter_email', filterReporterEmail);

            const queryString = params.toString();
            const data = await fetchAPI(`/admin/reports?${queryString}`);

            // Render results into the filtered results modal table body
            filteredResultsTableBody.innerHTML = '';
            const items = (data && Array.isArray(data.items)) ? data.items : [];
            if (items.length === 0) {
                filteredResultsTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:12px;">No reports found for the selected filters.</td></tr>';
            } else {
                items.forEach(report => {
                    const tr = document.createElement('tr');
                    const reporterEmail = report.reporter_email || '';
                    tr.innerHTML = `
                        <td>${escapeHtml(String(report.report_id || '').substring(0,8))}...</td>
                        <td>${escapeHtml(report.title || '')}</td>
                        <td><strong>${escapeHtml(report.reporter_username || 'Unknown')}</strong><br><small>${escapeHtml(reporterEmail)}</small></td>
                        <td>${report.severity ? `<span class="status-badge ${escapeHtml(report.severity)}">${escapeHtml(report.severity)}</span>` : ''}</td>
                        <td>${report.status ? `<span class="status-badge ${escapeHtml(String(report.status).toLowerCase().replace(' ', '-'))}">${escapeHtml(report.status)}</span>` : ''}${(report.status !== 'Resolved' && report.assignee_username) ? `<br><small><b>Assigned:</b> ${escapeHtml(report.assignee_username)}</small>` : ''}</td>
                        <td>${report.created_at ? escapeHtml(new Date(report.created_at).toLocaleString()) : ''}</td>
                    `;
                    filteredResultsTableBody.appendChild(tr);

                    // If this filtered result is a resolved report, append compliance badge
                    try {
                        if (report.status === 'Resolved') {
                            const statusTd = tr.querySelector('td[data-label="Status"]');
                            if (statusTd) {
                                let complianceBadgeHtml = '';
                                if (report.latest_compliance_status) {
                                    const cStatus = report.latest_compliance_status === 'compliant' ? 'Compliant' : 'Non-compliant';
                                    const cClass = report.latest_compliance_status === 'compliant' ? 'badge-compliant' : 'badge-noncompliant';
                                    const cTs = report.latest_compliance_at ? new Date(report.latest_compliance_at).toLocaleString() : '';
                                    complianceBadgeHtml = `<br><span class="compliance-badge ${cClass}" title="Checked: ${cTs}">${cStatus}</span>`;
                                }
                                statusTd.innerHTML = statusTd.innerHTML + complianceBadgeHtml;
                            }
                        }
                    } catch (e) {
                        console.warn('Failed to append compliance badge to filtered results row', e);
                    }
                });
            }

            // Update header with count
            try {
                const header = document.getElementById('filteredResultsHeader');
                if (header) header.textContent = `Filtered Reports — ${items.length} result${items.length !== 1 ? 's' : ''}`;
            } catch (e) { /* ignore */ }

            // Show modal
            if (filteredResultsModal) {
                filteredResultsModal.style.display = 'flex';
                document.body.style.overflow = 'hidden';
            }
        } catch (err) {
            console.error('Failed to apply filters:', err);
            showError(err.message || 'Failed to apply filters');
        }
    }

    async function loadAllReports() {
        // Load all reports for the main table.
        // Use date filters only if the admin has set them and wants to narrow the main table view.
        const dateFrom = document.getElementById('filterDateFrom') ? document.getElementById('filterDateFrom').value : '';
        const dateTo = document.getElementById('filterDateTo') ? document.getElementById('filterDateTo').value : '';

        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
        // Include severity filter when selected on the admin page
        try {
            const severity = (filterSeveritySelect && filterSeveritySelect.value) ? String(filterSeveritySelect.value).trim() : '';
            if (severity) params.append('severity', severity);
        } catch (e) { /* ignore */ }

        const queryString = params.toString();
        try {
            const data = await fetchAPI(`/admin/reports?${queryString}`);

            allReportsTableBody.innerHTML = ''; // Clear existing reports

            if (data.items.length === 0) {
                allReportsTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No reports found.</td></tr>';
                return;
            }


            data.items.forEach(report => {
                const row = document.createElement('tr');

                // Create cells with their data attributes (assignment history will be appended last)
                const reporterEmail = report.reporter_email || '';
                const cells = [
                    { label: 'ID', content: `${report.report_id.substring(0, 8)}...` },
                    { label: 'Title', content: report.title },
                    { label: 'Reporter', content: `<strong>${escapeHtml(report.reporter_username || 'Unknown')}</strong><br><small>${escapeHtml(reporterEmail)}</small>` },
                    { label: 'Severity', content: `<span class="status-badge ${report.severity}">${report.severity}</span>` },
                    { 
                        label: 'Status & Assignee', 
                        content: `<span class="status-badge ${report.status.toLowerCase().replace(' ', '-')}">${report.status}</span>
                                 ${(report.status !== 'Resolved' && report.assignee_username) ? `<br><small><b>Assigned:</b> ${escapeHtml(report.assignee_username)}</small>` : ''}`
                    },
                    { label: 'Timestamp', content: new Date(report.created_at).toLocaleString() }
                ];

                // Create all data cells (except assignment history, which will be added after Action)
                cells.forEach(cell => {
                    const td = document.createElement('td');
                    td.setAttribute('data-label', cell.label);
                    td.innerHTML = cell.content;
                    row.appendChild(td);
                });

                // If the report is resolved, append a compliance badge 
                // The backend projects 'latest_compliance_status` and `latest_compliance_at` for quick access.
                try {
                    const statusCell = row.querySelector('td[data-label="Status & Assignee"]');
                    if (statusCell && report.status === 'Resolved') {
                        let complianceBadgeHtml = '';
                        if (report.latest_compliance_status) {
                            const cStatus = report.latest_compliance_status === 'compliant' ? 'Compliant' : 'Non-compliant';
                            const cClass = report.latest_compliance_status === 'compliant' ? 'badge-compliant' : 'badge-noncompliant';
                            const cTs = report.latest_compliance_at ? new Date(report.latest_compliance_at).toLocaleString() : '';
                            complianceBadgeHtml = `<br><span class="compliance-badge ${cClass}" title="Checked: ${cTs}">${cStatus}</span>`;
                        }
                        statusCell.innerHTML = statusCell.innerHTML + complianceBadgeHtml;
                    }
                } catch (e) {
                    console.warn('Failed to append compliance badge to admin main table row', e);
                }

                // Create the action cell separately for better control
                const actionCell = document.createElement('td');
                actionCell.setAttribute('data-label', 'Action');

                if (report.status === 'Resolved') {
                    const detailsBtn = document.createElement('button');
                    detailsBtn.className = 'btn btn-info details-btn';
                    detailsBtn.textContent = 'Report Details';

                    // Clean and validate the report ID before setting it
                    const rawId = report.report_id;
                    console.log('Raw report_id value:', rawId);
                    console.log('Raw report_id type:', typeof rawId);
                    console.log('Raw report_id char codes:', Array.from(String(rawId)).map(c => `${c}(${c.charCodeAt(0)})`));

                    // Extract just the hex characters
                    const cleanId = String(rawId).replace(/[^a-fA-F0-9]/g, '');
                    const idLength = cleanId.length;
                    console.log('Cleaned ID:', cleanId);
                    console.log('Cleaned ID length:', idLength);

                    // Highlight any non-hex characters in the original
                    const nonHexMatch = String(rawId).match(/[^a-fA-F0-9]/g);
                    if (nonHexMatch) {
                        console.warn('Found non-hex characters:', nonHexMatch);
                    }

                    // Only set the attribute if we have a valid 24-char hex string
                    if (cleanId && cleanId.length === 24) {
                        detailsBtn.setAttribute('data-report-id', cleanId);
                    } else {
                        console.error('Invalid ObjectId format:', {
                            original: rawId,
                            cleaned: cleanId,
                            expectedLength: 24,
                            actualLength: idLength
                        });
                    }

                    // Verify what was actually set
                    console.log('Final data-report-id value:', detailsBtn.getAttribute('data-report-id'));

                    actionCell.appendChild(detailsBtn);
                } else {
                    if (report.assignee_username) {
                        const reassignBtn = document.createElement('button');
                        reassignBtn.className = 'btn btn-secondary reassign-btn';
                        reassignBtn.textContent = 'Reassign';
                        reassignBtn.setAttribute('data-report-id', report.report_id);
                        reassignBtn.setAttribute('data-report-title', report.title);
                        reassignBtn.addEventListener('click', handleReassignInline);
                        actionCell.appendChild(reassignBtn);
                    } else {
                        const assignBtn = document.createElement('button');
                        assignBtn.className = 'btn btn-primary assign-btn';
                        assignBtn.textContent = 'Assign';
                        assignBtn.setAttribute('data-report-id', report.report_id);
                        assignBtn.addEventListener('click', handleReportAssignment);
                        actionCell.appendChild(assignBtn);
                    }

                    // Only show Resolve button when the report is not yet resolved but there has been an assignment or reassignment for it.
                    const hasAssignment = Boolean(report.assignee_username) || (typeof report.assignment_count === 'number' && report.assignment_count > 0) || Boolean(report.is_reassignment);
                    if (report.status !== 'Resolved' && hasAssignment) {
                        const resolveBtn = document.createElement('button');
                        resolveBtn.className = 'btn btn-success resolve-btn';
                        resolveBtn.textContent = 'Resolve';
                        resolveBtn.setAttribute('data-report-id', report.report_id);
                        resolveBtn.addEventListener('click', handleResolveReport);
                        actionCell.appendChild(resolveBtn);
                    }
                }

                // Append action cell now
                row.appendChild(actionCell);

                // Append assignment history as the last column
                const historyTd = document.createElement('td');
                historyTd.setAttribute('data-label', 'Assignment History');
                if (report.assignee_username || (typeof report.assignment_count === 'number' && report.assignment_count > 0)) {
                    // Use consistent system button styling (reuse info button style)
                    historyTd.innerHTML = `<button class="btn btn-info assignment-history-btn" data-report-id="${report.report_id}" data-include-current="true">View History</button>`;
                } else {
                    historyTd.textContent = 'Not Assigned';
                }
                row.appendChild(historyTd);

                allReportsTableBody.appendChild(row);
            });

            // Add event listeners for action buttons
            // Details buttons: prefer central validated handler `handleShowReportDetails`
            document.querySelectorAll('.assign-btn').forEach(button => {
                button.addEventListener('click', handleReportAssignment);
            });
            document.querySelectorAll('.reassign-btn').forEach(button => {
                button.addEventListener('click', handleReassignInline);
            });
            // Resolve buttons
            document.querySelectorAll('.resolve-btn').forEach(button => {
                button.addEventListener('click', handleResolveReport);
            });
            // Details buttons are handled via event delegation on the table body

            // Assignment history buttons: attach direct handlers to ensure they respond
            document.querySelectorAll('.assignment-history-btn').forEach(btn => {
                try {
                    btn.removeEventListener && btn.removeEventListener('click', () => {});
                } catch (e) { /* ignore */ }
                btn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    const id = btn.getAttribute('data-report-id');
                    const includeCurrent = btn.getAttribute('data-include-current') !== 'false';
                    if (id) showAssignmentHistoryModal(id, includeCurrent);
                });
            });

        } catch (error) {
            showError(error.message);
        }
    }

    // Resolve modal which uses stored assignee feedback as the source for resolution steps.
    async function handleResolveReport(e) {
        const reportId = e.target.getAttribute('data-report-id');
        if (!reportId) return;
        // Open the overlay-based resolve modal implemented below which fetches assignment history and per-assignee feedback.
        try {
            await showResolveModal(reportId);
        } catch (err) {
            console.error('Failed to open resolve modal:', err);
            showError('Unable to open resolve dialog');
        }
    }

    // Fetch single report and show in a modal report details
    async function handleShowReportDetails(reportId) {
        if (typeof reportId === 'object' && (reportId.currentTarget || reportId.target)) {
            // If called from event listener: prefer currentTarget, fallback to target
            const evt = reportId;
            const el = evt.currentTarget || evt.target;
            reportId = el.getAttribute('data-report-id');
        }
        
        // Extended debug logging to trace ID value at each step
        console.log('Initial report ID:', reportId);
        console.log('Initial report ID type:', typeof reportId);
        console.log('Initial report ID value repr:', JSON.stringify(reportId));
        if (reportId && typeof reportId === 'string') {
            console.log('Initial ID hex test:', /^[a-fA-F0-9]{24}$/.test(reportId));
            console.log('Initial ID length:', reportId.length);
            console.log('Initial ID chars:', Array.from(reportId).map(c => c.charCodeAt(0)));
        }

        if (!reportId) {
            showError('Invalid report ID format');
            return;
        }

        // Basic client-side validation: expect a 24-hex Mongo ObjectId
        const trimmed = String(reportId).trim();
        console.log('Trimmed ID:', trimmed);
        console.log('Trimmed ID length:', trimmed.length);
        console.log('Trimmed ID hex test:', /^[a-fA-F0-9]{24}$/.test(trimmed));
        console.log('Trimmed ID chars:', Array.from(trimmed).map(c => c.charCodeAt(0)));

        const hexTest = /^[a-fA-F0-9]{24}$/.test(trimmed);
        if (!hexTest) {
            showError('Invalid report ID format (client validation)');
            return;
        }
        reportId = trimmed;

    // Disable the originating button (if present) to prevent multiple clicks
    const originatingBtn = document.querySelector(`[data-report-id="${reportId}"]`);
    if (originatingBtn) originatingBtn.disabled = true;
        
        // Clear any existing modal first
        const existingOverlay = document.querySelector('.report-details-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }
        
        try {
            const data = await fetchAPI(`/admin/reports/${reportId}`);
            if (!data) {
                throw new Error('Failed to load report details');
            }
            showReportDetailsModal(data);
        } catch (err) {
            const errorMessage = err.message || 'Failed to load report details';
            showError(errorMessage);
        } finally {
            // Re-enable the originating button if it was disabled
            if (originatingBtn) originatingBtn.disabled = false;
        }
    }

function showReportDetailsModal(response) {
    // Extract report and assignments from the response
    const report = response.report || response;
    const assignments = response.assignments || [];

    // Remove any existing modal
    const existingOverlay = document.querySelector('.report-details-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'report-details-overlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '10000'
    });

    // Create modal content
    const modal = document.createElement('div');
    Object.assign(modal.style, {
        background: '#fff',
        padding: '20px',
        borderRadius: '6px',
        maxWidth: '600px',
        width: '90%',
        maxHeight: '80vh',
        overflowY: 'auto'
    });

    // Close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '&times;';
    Object.assign(closeButton.style, {
        float: 'right',
        border: 'none',
        background: 'none',
        fontSize: '24px',
        cursor: 'pointer',
        lineHeight: '1'
    });
    closeButton.onclick = () => overlay.remove();
    modal.appendChild(closeButton);

    // Title
    const title = document.createElement('h3');
    title.textContent = `Report Details — ${report.title || ''}`;
    title.style.marginRight = '30px';
    modal.appendChild(title);

    // Metadata
    const meta = document.createElement('p');
    // Build metadata with an optional compliance badge if available
    let complianceHtml = '';
    try {
        if (report.latest_compliance_status) {
            const cStatus = report.latest_compliance_status === 'compliant' ? 'Compliant' : 'Non-compliant';
            const cClass = report.latest_compliance_status === 'compliant' ? 'badge-compliant' : 'badge-noncompliant';
            const cTs = report.latest_compliance_at ? new Date(report.latest_compliance_at).toLocaleString() : '';
            complianceHtml = `<br><strong>Compliance:</strong> <span class="compliance-badge ${cClass}" title="Checked: ${cTs}">${cStatus}</span>`;
        }
    } catch (e) {
        complianceHtml = '';
    }

    meta.innerHTML = `
        <strong>Created:</strong> ${report.created_at ? new Date(report.created_at).toLocaleString() : 'N/A'}<br>
        <strong>Status:</strong> ${report.status || 'Unknown'}<br>
        <strong>Resolved:</strong> ${report.resolved_at ? new Date(report.resolved_at).toLocaleString() : 'Not resolved'}
        ${complianceHtml}
    `;
    modal.appendChild(meta);

    // Report Content
    const contentTitle = document.createElement('h4');
    contentTitle.textContent = 'Report Content';
    modal.appendChild(contentTitle);

    const content = document.createElement('div');
    Object.assign(content.style, {
        whiteSpace: 'pre-wrap',
        background: '#f7f7f7',
        padding: '15px',
        borderRadius: '4px',
        border: '1px solid #ddd',
        marginTop: '10px',
        fontSize: '14px',
        lineHeight: '1.5'
    });

    // Get report details from either the report or the most recent assignment
    let details = report.details || report.detail;
    if (!details && assignments.length > 0) {
        details = assignments[0].details || assignments[0].detail;
    }

    // Show severity if available
    if (report.severity || (assignments[0] && assignments[0].severity)) {
        const severity = report.severity || assignments[0].severity;
        content.innerHTML = `<strong>Severity:</strong> ${severity}<br><br>`;
    }

    // Add the report details or fallback message
    if (details) {
        content.innerHTML += details;
    } else {
        content.textContent = 'No details available.';
        content.style.color = '#666';
        content.style.fontStyle = 'italic';
    }
    modal.appendChild(content);

    // Bottom close button
    const bottomClose = document.createElement('button');
    bottomClose.className = 'btn btn-secondary';
    bottomClose.textContent = 'Close';
    bottomClose.style.marginTop = '12px';
    bottomClose.onclick = () => overlay.remove();
    modal.appendChild(bottomClose);

    // Add to document
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// Show assignment/(re)assignment history for a single report in a modal
async function showAssignmentHistoryModal(reportId, includeCurrent = true) {
    if (!reportId) return;
    // Remove existing overlay if present
    const existing = document.querySelector('.assignment-history-overlay');
    if (existing) existing.remove();

    // Keep underlying modals visible; history will overlay on top.

    // Create a plain overlay element (avoid generic 'modal' class to prevent other handlers closing it)
    const overlay = document.createElement('div');
    overlay.className = 'assignment-history-overlay';
    Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', right: '0', bottom: '0', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '11000' });

    const modal = document.createElement('div');
    Object.assign(modal.style, { background: '#fff', padding: '20px', borderRadius: '6px', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto', position: 'relative' });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '&times;';
    Object.assign(closeBtn.style, { position: 'absolute', top: '8px', right: '8px', border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer' });
    closeBtn.addEventListener('click', () => { overlay.remove(); });
    modal.appendChild(closeBtn);

    const h = document.createElement('h3');
    h.textContent = 'Assignment History';
    modal.appendChild(h);

    const container = document.createElement('div');
    container.style.maxHeight = '60vh';
    container.style.overflow = 'auto';
    container.style.marginTop = '8px';
    modal.appendChild(container);

    overlay.appendChild(modal);
    // Allow clicking the backdrop to close the history overlay without affecting underlying modals
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    document.body.appendChild(overlay);

    // Clean the report id (strip non-hex characters) similar to details handling
    const rawId = String(reportId || '');
    const cleanId = rawId.replace(/[^a-fA-F0-9]/g, '');
    let idToUse = rawId;
    if (cleanId && cleanId.length === 24) idToUse = cleanId;

    try {
        // Always fetch the unified, flattened assignment history from the dedicated endpoint
        const histResp = await fetchAPI(`/admin/assignments/${idToUse}/history`);
        console.debug('assignment history response for', idToUse, histResp);
        const assignments = (histResp && histResp.assignments) ? histResp.assignments : [];

        // If caller requests excluding the current assignment, drop the newest entry
        try {
            if (!includeCurrent && Array.isArray(assignments) && assignments.length > 0) {
                // Backend returns oldest->newest; drop the last (current) entry
                assignments = assignments.slice(0, assignments.length - 1);
            }
        } catch (e) { /* ignore */ }

        if (!assignments || !assignments.length) {
            container.innerHTML = '<p>No assignment history found for this report.</p>';
            return;
        }

        // Use local variable to allow optional removal of current assignment below
        let entries = assignments || [];

        // If caller requested excluding current assignment, drop the newest entry
        try {
            if (!includeCurrent && Array.isArray(entries) && entries.length > 0) {
                entries = entries.slice(0, entries.length - 1);
            }
        } catch (e) { /* ignore */ }

        // Show newest first
        entries.slice().reverse().forEach(a => {
            const card = document.createElement('div');
            card.style.borderLeft = '3px solid #ccc';
            card.style.paddingLeft = '10px';
            card.style.margin = '8px 0';
            const at = a.assigned_at ? new Date(a.assigned_at).toLocaleString() : 'Unknown time';
            card.innerHTML = `<strong>${escapeHtml(a.assignee_name || a.assignee_username || a.assignee_email || 'Unknown')}</strong> <br/><small>${escapeHtml(a.assignee_email || '')} • ${escapeHtml(at)}</small>${a.notes ? `<pre style="white-space:pre-wrap; margin-top:6px;">${escapeHtml(a.notes)}</pre>` : ''}`;
            container.appendChild(card);
        });
    } catch (err) {
        console.error('Failed to load assignment history:', err);
        container.innerHTML = '<p style="color:var(--danger-color);">Failed to load assignment history.</p>';
    }
}

    const fetchAndRenderAssignments = async () => {
        const tbody = document.querySelector('#assignmentsTable tbody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">Loading assignments...</td></tr>';

        try {
            const data = await fetchAPI('/admin/reports');
            const allReports = data.items;

            // Filter for reports that are assigned to someone and are not yet resolved
            const assignedReports = allReports.filter(report => report.assignee_username && report.status !== 'Resolved');

            tbody.innerHTML = '';
            if (assignedReports.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No reports are currently assigned.</td></tr>';
                return;
            }

            assignedReports.forEach(report => {
                const row = tbody.insertRow();
                let timestamp = 'N/A';
                if (report.created_at) {
                    timestamp = new Date(report.created_at).toLocaleString();
                }
                const statusColor = report.status.toLowerCase().includes('in progress') ? 'var(--primary-light)' : 'var(--warning-color)';

                row.innerHTML = `
                    <td data-label="Report ID">${report.report_id.substring(0, 8)}...</td>
                    <td data-label="Report Title">${escapeHtml(report.title || '')}</td>
                    <td data-label="Assigned To">${escapeHtml(report.assignee_username || '')}</td>
                    <td data-label="Status"><span class="status-badge" style="background-color: ${statusColor};">${escapeHtml(report.status || '')}</span></td>
                    <td data-label="Date Submitted">${timestamp}</td>
                    <td data-label="Reassignment History">${(report.assignment_count && report.assignment_count > 1) ? `<button class="btn btn-info assignment-history-btn" data-report-id="${escapeHtml(report.report_id)}" data-include-current="false">View History</button>` : 'No History'}</td>
                `;
            });
            // Attach click handlers for history buttons inside the assignments modal
            try {
                document.querySelectorAll('#assignmentsTable .assignment-history-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        const id = btn.getAttribute('data-report-id');
                        const includeCurrent = btn.getAttribute('data-include-current') !== 'false';
                        if (id) showAssignmentHistoryModal(id, includeCurrent);
                    });
                });
            } catch (e) {
                console.warn('Failed to attach assignment-history handlers in assignments modal', e);
            }
        } catch (error) {
            console.error('Fetch Assignments Error:', error);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger-color); padding: 20px;">${error.message}</td></tr>`;
        }
    };

    async function handleReportAssignment(e) {
        const reportId = e.target.getAttribute('data-report-id');
        const assigneeName = prompt(`Assign/Reassign Report ID ${reportId.substring(0, 8)}...\nEnter assignee's name:`);
        if (!assigneeName) return;

        const assigneeEmail = prompt(`Enter ${assigneeName}'s email:`);
        if (assigneeEmail) {
                try {
                    // Show processing overlay immediately
                    showProcessing('Please wait...');
                    try {
                        const data = await fetchAPI(`/admin/reports/${reportId}/assign`, {
                            method: 'PATCH',
                            body: JSON.stringify({ assignee_name: assigneeName, assignee_email: assigneeEmail, type: 'assignment' }),
                            showProcessing: false
                        });
                        // Hide the processing overlay before showing the success alert so it disappears as the alert appears
                        try { hideProcessing(); } catch (e) { /* swallow */ }
                        alert(data.message);
                        loadAllReports(); // Refresh the table
                    } catch (error) {
                        try { hideProcessing(); } catch (e) { /* swallow */ }
                        throw error;
                    }
                } catch (error) {
                    showError(error.message);
                }
        }
    }

    // Inline reassign handler: prompts for assignee name/email and calls assign API
    async function handleReassignInline(e) {
        const el = e.currentTarget || e.target;
        const reportId = el.getAttribute('data-report-id');
        const reportTitle = el.getAttribute('data-report-title') || '';

        if (!reportId) {
            showError('Missing report id for reassignment');
            return;
        }

        // Ask for assignee name and email 
        const assigneeName = prompt(`Reassign Report ${reportId.substring(0,8)}...\nEnter assignee's name:`);
        if (!assigneeName) return;

        const assigneeEmail = prompt(`Enter ${assigneeName}'s email:`);
        if (!assigneeEmail) return;

        try {
            showProcessing('Please wait...');
            try {
                const data = await fetchAPI(`/admin/reports/${reportId}/assign`, {
                    method: 'PATCH',
                    body: JSON.stringify({ assignee_name: assigneeName, assignee_email: assigneeEmail, type: 'reassignment' }),
                    showProcessing: false
                });
                try { hideProcessing(); } catch (e) { /* swallow */ }
                alert(data.message || 'Report reassigned successfully.');
                // Refresh table
                loadAllReports();
            } catch (error) {
                try { hideProcessing(); } catch (e) { /* swallow */ }
                throw error;
            }
        } catch (error) {
            showError(error.message || 'Failed to reassign report');
        }
    }

    function showError(message) {
        if (errorMessage) {
            // Remove any existing error first
            errorMessage.classList.remove('show');
            errorMessage.textContent = '';
            
            // Set new error and show it
            errorMessage.textContent = message;
            errorMessage.classList.add('show');

            // Auto-hide after 3 seconds
            setTimeout(() => {
                errorMessage.classList.remove('show');
                errorMessage.textContent = '';
            }, 3000);
        } else {
            // Fallback when the admin page doesn't include an error-message container
            console.error('UI error:', message);
            try { alert(message); } catch (e) { /* ignore */ }
        }
    }

    // Initial load of reports
    // Event delegation fallback for dynamically created buttons (ensures clicks are handled)
    allReportsTableBody.addEventListener('click', (e) => {
        const detailsBtn = e.target.closest && e.target.closest('.details-btn');
        if (detailsBtn) {
            e.preventDefault();
            const reportId = detailsBtn.getAttribute('data-report-id');
            console.log('Clicked report ID:', reportId); // Debug logging
            if (reportId) {
                handleShowReportDetails(reportId);
            }
            return;
        }

        const historyBtn = e.target.closest && e.target.closest('.assignment-history-btn');
        if (historyBtn) {
            e.preventDefault();
            const reportId = historyBtn.getAttribute('data-report-id');
            const includeCurrent = historyBtn.getAttribute('data-include-current') !== 'false';
            if (reportId) {
                showAssignmentHistoryModal(reportId, includeCurrent);
            }
            return;
        }
    });

    // Global delegated handler for any assignment-history-btn across the page (covers dynamically added buttons)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.assignment-history-btn');
        if (!btn) return;
        try {
            e.preventDefault();
            const id = btn.getAttribute('data-report-id') || btn.dataset.reportId;
            const includeCurrent = btn.getAttribute('data-include-current') !== 'false';
            if (id) showAssignmentHistoryModal(id, includeCurrent);
        } catch (err) {
            console.error('Failed delegated assignment-history click', err);
        }
    });

    loadAllReports();
});
