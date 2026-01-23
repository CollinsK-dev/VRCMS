function showModal(content, options = { closable: true, size: 'medium', className: '' }) {
    const modal = document.createElement('div');
    modal.className = 'modal';

    // Determine modal-content sizing class
    const sizeClass = options.size ? `modal-${options.size}` : '';
    const extraClass = options.className ? ` ${options.className}` : '';

    modal.innerHTML = `
        <div class="modal-content ${sizeClass}${extraClass}">
            <button class="close-modal" aria-label="Close modal">×</button>
            ${content}
        </div>
    `;
    document.body.appendChild(modal);

    // Show modal with animation
    requestAnimationFrame(() => {
        modal.classList.add('show');
        modal.style.display = 'flex';
    });

    // Close modal functionality
    function closeModal() {
        modal.classList.remove('show');
        modal.style.display = 'none';
        setTimeout(() => modal.remove(), 300);
    }

    // Close modal on outside click, close button, or Escape key
    modal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal') || e.target.classList.contains('close-modal')) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });

    // Return the modal element so callers can close this specific instance
    return modal;
}

document.addEventListener('DOMContentLoaded', () => {
    // Grab common DOM elements used throughout the page. 
    // Defensively query them so pages that omit elements won't throw ReferenceError.
    const userInfo = document.getElementById('user-info');
    const logoutBtn = document.getElementById('logoutBtn');
    const recordAuditBtn = null;
    const viewAuditsBtn = document.getElementById('viewAuditsBtn');

// Simple page-level message helpers used across this file
function showError(message) {
    const el = document.getElementById('error-message');
    if (el) {
        el.textContent = message;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 5000);
        return;
    }
    // Fallback
    console.error(message);
}

function showSuccess(message) {
    const el = document.getElementById('success-message');
    if (el) {
        el.textContent = message;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 5000);
        return;
    }
    // Fallback
    console.log(message);
}

// Small helper to safely escape HTML when injecting strings into innerHTML
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
    setTimeout(() => {
        if (userInfo) userInfo.style.display = 'none';
    }, 2000);

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.clear();
            window.location.href = 'login.html';
        });
    }

    // Set up event delegation for action buttons
    document.addEventListener('click', async (e) => {
        if (e.target.closest('.actions-taken-btn')) {
            const btn = e.target.closest('.actions-taken-btn');
            const reportId = btn.dataset.reportId;
            await showActionsTakenModal(reportId);
        }
    });

    // Initial load of stats
    fetchStats();

    async function fetchStats() {
        try {
            // Previously this function updated many on-page "stat card" elements
            // such as resolved/pending/open and per-severity counts. Those
            // stat cards are no longer used; to avoid DOM churn we still call
            // the endpoint for any other consumers but we do not update the
            // old stat-card elements here.
            await fetchAPI('/audit/stats');
        } catch (error) {
            console.error('Error fetching stats:', error);
            showError('Failed to load statistics');
        }
    }

    // --- Severity trend chart (stacked area) ---
    async function renderSeverityTrend(startDate, endDate) {
        try {
            // Build query params
            const qs = `?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;
            const resp = await fetchAPI(`/audit/reports/timeseries${qs}`);
            const items = resp && resp.items ? resp.items : [];

            const labels = items.map(i => i.date);
            const critical = items.map(i => i.critical || 0);
            const high = items.map(i => i.high || 0);
            const medium = items.map(i => i.medium || 0);
            const low = items.map(i => i.low || 0);

            const ctx = document.getElementById('auditorSeverityTrend');
            if (!ctx) return;
            // Destroy previous chart if present
            if (window._auditorSeverityChart) {
                try { window._auditorSeverityChart.destroy(); } catch (e) { /* ignore */ }
            }

            // Create stacked area chart using Chart.js
            window._auditorSeverityChart = new Chart(ctx.getContext('2d'), {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Critical',
                            data: critical,
                            borderColor: '#e74c3c',
                            backgroundColor: 'rgba(231,76,60,0.25)',
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: 'High',
                            data: high,
                            borderColor: '#e67e22',
                            backgroundColor: 'rgba(230,126,34,0.22)',
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: 'Medium',
                            data: medium,
                            borderColor: '#f1c40f',
                            backgroundColor: 'rgba(241,196,15,0.20)',
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: 'Low',
                            data: low,
                            borderColor: '#2ecc71',
                            backgroundColor: 'rgba(46,204,113,0.18)',
                            fill: true,
                            tension: 0.3
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    stacked: true,
                    plugins: {
                        legend: { position: 'top' }
                    },
                    scales: {
                        x: {
                            display: true,
                            title: { display: false }
                        },
                        y: {
                            display: true,
                            stacked: true,
                            beginAtZero: true,
                            title: { display: true, text: 'Reports' }
                        }
                    }
                }
            });
        } catch (err) {
            console.error('Failed to render severity trend:', err);
        }
    }

    // Helper: compute default last-30-days range and render chart
    (function initSeverityChart() {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 29);
        const fmt = (d) => d.toISOString().slice(0,10);
        // If the date inputs exist and user has chosen a range, prefer those
        const startEl = document.getElementById('reportStartDate');
        const endEl = document.getElementById('reportEndDate');
        const startVal = startEl && startEl.value ? startEl.value : fmt(start);
        const endVal = endEl && endEl.value ? endEl.value : fmt(end);
        renderSeverityTrend(startVal, endVal);

        // Re-render when the date inputs change (user chooses range for PDF)
        if (startEl && endEl) {
            [startEl, endEl].forEach(el => el.addEventListener('change', () => {
                const sv = startEl.value;
                const ev = endEl.value;
                if (sv && ev) renderSeverityTrend(sv, ev);
            }));
        }
    })();

// --- View audits --- 
    if (viewAuditsBtn) {
        viewAuditsBtn.addEventListener('click', async () => {
        try {
            // Show reports that have been cross-checked against compliance
            const resp = await fetchAPI('/audit/reports/checked');
            const reports = resp && resp.items ? resp.items : [];
            showCheckedReportsModal(reports);
        } catch (error) {
            console.error('Error fetching checked reports:', error);
            showError('Failed to load checked reports');
        }
        });
    }

    // Open Compliance modal (fetch standards and render checklist)
    const openComplianceBtn = document.getElementById('openComplianceBtn');
    if (openComplianceBtn) {
        openComplianceBtn.addEventListener('click', async () => {
            try {
                // Fetch standards and the list of submitted reports so the auditor
                // can pick a report and immediately start a compliance check.
                const [stdResp, reportsResp] = await Promise.all([
                    fetchAPI('/audit/compliance/standards'),
                    fetchAPI('/audit/reports')
                ]);
                const standards = stdResp && stdResp.standards ? stdResp.standards : [];
                let reports = reportsResp && reportsResp.items ? reportsResp.items : (Array.isArray(reportsResp) ? reportsResp : []);
                // Exclude reports that have already been checked (latest_compliance_status present)
                reports = reports.filter(r => !r.latest_compliance_status);
                openReportsListModal(reports, standards);
            } catch (err) {
                console.error('Failed to load compliance standards or reports:', err);
                showError('Failed to load compliance data');
            }
        });
    }

    function showAuditHistory(audits) {
        // Defensive rendering: audits may contain records with missing fields
        const modalContent = `
            <h2>My Audit History</h2>
            <div class="audit-history">
                ${(Array.isArray(audits) ? audits : []).map(audit => {
                    const ts = audit && audit.timestamp ? new Date(audit.timestamp).toLocaleString() : 'Unknown time';
                    const total = audit && (audit.total_reports || audit.total) != null ? (audit.total_reports || audit.total) : 'N/A';
                    const resolved = audit && audit.resolved_reports != null ? audit.resolved_reports : 'N/A';
                    const open = audit && audit.open_reports != null ? audit.open_reports : 'N/A';

                    // severity_snapshot may be null/undefined for older records — guard it
                    const snapshot = (audit && audit.severity_snapshot) ? audit.severity_snapshot : {};
                    const severityEntries = Object.keys(snapshot).length ? Object.entries(snapshot).map(([severity, data]) => {
                        // guard data fields as well
                        const totalS = data && data.total != null ? data.total : 'N/A';
                        const resolvedS = data && data.resolved != null ? data.resolved : 'N/A';
                        return `<li>${severity}: ${totalS} (Resolved: ${resolvedS})</li>`;
                    }).join('') : '<li>No severity data available</li>';

                    return `
                    <div class="audit-entry">
                        <div class="audit-date">${ts}</div>
                        <div class="audit-stats">
                            <p>Total Reports: ${total}</p>
                            <p>Resolved: ${resolved}</p>
                            <p>Open: ${open}</p>
                        </div>
                        <div class="severity-stats">
                            <h4>Severity Breakdown:</h4>
                            <ul>
                                ${severityEntries}
                            </ul>
                        </div>
                    </div>`;
                }).join('')}
            </div>`;

        showModal(modalContent);
    }

    // Show modal listing reports that have been cross-checked (checked reports)
    function showCheckedReportsModal(reports) {
        const rows = (Array.isArray(reports) ? reports : []).map(r => {
            const title = r.title || 'Untitled';
            const statusText = r.status || 'Unknown';
            const createdAt = r.created_at ? new Date(r.created_at).toLocaleString() : '';
            const complianceStatus = r.latest_compliance_status || 'Checked';
            const ts = r.latest_compliance_at ? new Date(r.latest_compliance_at).toLocaleString() : '';
            return `<tr data-report-id="${r.report_id}">
                        <td>${escapeHtml(title)}</td>
                        <td>${escapeHtml(String(r.severity || 'Unknown'))}</td>
                        <td>${escapeHtml(statusText)}</td>
                        <td>${createdAt}</td>
                        <td>${escapeHtml(complianceStatus)} ${ts ? `<br/><small>${ts}</small>` : ''}</td>
                        <td>
                            <div class="button-group">
                                <button class="btn btn-primary view-compliance-history" data-report-id="${r.report_id}">Compliance History</button>
                            </div>
                        </td>
                    </tr>`;
        }).join('');

        const content = `
            <h2>Checked Reports</h2>
            <div class="reports-list">
                <table class="table full-width">
                    <thead><tr><th>Title</th><th>Severity</th><th>Status</th><th>Created</th><th>Compliance</th><th>Action</th></tr></thead>
                    <tbody>
                        ${rows || '<tr><td colspan="6" style="text-align:center;">No checked reports found.</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div style="margin-top:1rem; text-align:right;"><button class="btn btn-secondary close-checked-reports">Close</button></div>
        `;

        const modalEl = showModal(content, { closable: true, size: 'large' });
        setTimeout(() => {
            // Compliance history button: open overlay showing standards & results
            modalEl.querySelectorAll('.view-compliance-history').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                        const rid = btn.getAttribute('data-report-id');
                        try {
                            const resp = await fetchAPI(`/audit/report/${encodeURIComponent(rid)}/compliance`);
                            const checks = resp && resp.checks && resp.checks.length ? resp.checks[0] : null;
                            if (!checks) {
                                showModal('<h3>Compliance History</h3><p>No compliance record found for this report.</p>', { closable: true, size: 'small' });
                                return;
                            }

                            // Build HTML content using system styling classes
                            const auditor = escapeHtml(checks.auditor_username || checks.auditor_id || 'Unknown');
                            const checkedAt = checks.created_at ? new Date(checks.created_at).toLocaleString() : (checks.createdAt || '');
                            let html = `<h3>Compliance History</h3>`;
                            html += `<div class="small muted"><strong>Checked by:</strong> ${auditor}${checkedAt ? ` <span style="margin-left:12px;"><small>${escapeHtml(checkedAt)}</small></span>` : ''}</div>`;
                            html += `<div style="margin-top:12px;">`;
                            if (!checks.standards || !checks.standards.length) {
                                html += '<p>No standards recorded for this compliance check.</p>';
                            } else {
                                html += `<table class="table full-width"><thead><tr><th>Standard</th><th>Result</th><th>Notes</th></tr></thead><tbody>`;
                                for (const s of checks.standards) {
                                    const title = escapeHtml(s.title || s.control_id || s.standard_id || 'Unknown');
                                    const resText = s.result === 'compliant' ? 'Compliant' : 'Non-compliant';
                                    const notes = `<div style="white-space:pre-wrap;">${escapeHtml(s.notes || '')}</div>`;
                                    html += `<tr><td>${title}</td><td>${resText}</td><td>${notes}</td></tr>`;
                                }
                                html += `</tbody></table>`;
                            }
                            html += `</div>`;

                            showModal(html, { closable: true, size: 'small' });
                        } catch (err) { console.error('Failed to load compliance history:', err); showError('Failed to load compliance history'); }
                    });
            });

            const closeBtn = modalEl.querySelector('.close-checked-reports');
            if (closeBtn) closeBtn.addEventListener('click', () => { const cb = modalEl.querySelector('.close-modal'); if (cb) cb.click(); });
        }, 60);
    }

    // Render and handle Compliance modal
    // Modified to accept an optional prefillReportId. If provided, the Report ID
    // input is pre-filled and hidden to simplify the auditor workflow.
    function openComplianceModal(standards, prefillReportId = null) {
        const content = `
            <h2>Run Compliance Check</h2>
            <div class="form-group" id="complianceReportIdGroup">
                <label for="complianceReportId">Report ID</label>
                <input id="complianceReportId" class="input" placeholder="Enter report_id to check" />
            </div>
            <div class="standards-list">
                ${standards.map(s => `
                    <div class="standard-entry" data-standard-id="${s._id}">
                        <div style="display:flex; align-items:center; gap:8px; justify-content:space-between;">
                            <div>
                                <label style="font-weight:600;"><input type="checkbox" class="std-apply" data-std-id="${s._id}" /> ${s.control_id} - ${escapeHtml(s.name)}</label>
                                <div class="small muted" style="margin-top:4px;">${escapeHtml(s.description || '')}</div>
                            </div>
                            <div class="std-controls" style="min-width:220px; text-align:right;">
                                <div class="std-result" data-std-id="${s._id}" style="display:none;">
                                    <label><input type="radio" name="std_result_${s._id}" value="compliant" checked/> Compliant</label>
                                    <label style="margin-left:8px;"><input type="radio" name="std_result_${s._id}" value="non-compliant"/> Non-compliant</label>
                                </div>
                            </div>
                        </div>
                        <div style="margin-top:8px; display:none;" class="std-notes-wrapper" data-std-id="${s._id}">
                            <textarea placeholder="Notes (optional)" class="std-notes" data-std-id="${s._id}" style="width:100%; min-height:64px;"></textarea>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top:1rem; display:flex; gap:8px;">
                <button id="submitComplianceBtn" class="btn btn-primary">Submit</button>
                <button id="cancelComplianceBtn" class="btn btn-secondary">Cancel</button>
            </div>
        `;

    const modalEl = showModal(content, { closable: true });

        // Attach handlers after modal is in DOM
        setTimeout(() => {
            // Toggle display of result radios and notes when the standard checkbox is toggled
            modalEl.querySelectorAll('.std-apply').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const sid = cb.getAttribute('data-std-id');
                    const resultEl = modalEl.querySelector(`.std-result[data-std-id="${sid}"]`);
                    const notesWrapper = modalEl.querySelector(`.std-notes-wrapper[data-std-id="${sid}"]`);
                    if (cb.checked) {
                        if (resultEl) resultEl.style.display = 'block';
                        if (notesWrapper) notesWrapper.style.display = 'block';
                    } else {
                        if (resultEl) resultEl.style.display = 'none';
                        if (notesWrapper) notesWrapper.style.display = 'none';
                    }
                });
            });

            // If a prefilled report id was provided, fetch existing compliance record and pre-populate the form
            if (prefillReportId) {
                (async function() {
                    try {
                        const resp = await fetchAPI(`/audit/report/${encodeURIComponent(prefillReportId)}/compliance`);
                        const checks = resp && resp.checks ? resp.checks : [];
                        if (checks.length) {
                            // Use the first (latest) check to prefill
                            const latest = checks[0];
                            const standardsArr = latest.standards || [];
                            for (const s of standardsArr) {
                                const sid = s.standard_id;
                                const entry = modalEl.querySelector(`.standard-entry[data-standard-id="${sid}"]`);
                                if (!entry) continue;
                                const applyCb = entry.querySelector(`.std-apply[data-std-id="${sid}"]`);
                                if (applyCb) {
                                    applyCb.checked = true;
                                    // trigger display
                                    applyCb.dispatchEvent(new Event('change'));
                                }
                                // set radios
                                const resultRadios = entry.querySelectorAll(`input[name=std_result_${sid}]`);
                                if (resultRadios && resultRadios.length) {
                                    resultRadios.forEach(r => { r.checked = (r.value === (s.result || 'compliant')); });
                                }
                                // set notes
                                const notesEl = entry.querySelector('.std-notes');
                                if (notesEl && s.notes) notesEl.value = s.notes || '';
                            }
                            // Optionally set the hidden report id value
                            const ridEl = modalEl.querySelector('#complianceReportId');
                            if (ridEl) ridEl.value = prefillReportId;
                        }
                    } catch (err) {
                        console.warn('Failed to prefill compliance form:', err);
                    }
                })();
            }

            const submitBtn = modalEl.querySelector('#submitComplianceBtn');
            const cancelBtn = modalEl.querySelector('#cancelComplianceBtn');
            const viewActionsBtn = modalEl.querySelector('#viewActionsBtn');
            const reportIdEl = modalEl.querySelector('#complianceReportId');
            const reportIdGroup = modalEl.querySelector('#complianceReportIdGroup');
            if (prefillReportId && reportIdEl) {
                reportIdEl.value = prefillReportId;
                // Hide the input group but keep its value for form submit
                if (reportIdGroup) reportIdGroup.style.display = 'none';
            }
            if (cancelBtn) cancelBtn.addEventListener('click', () => { const cb = modalEl.querySelector('.close-modal'); if (cb) cb.click(); });
            if (viewActionsBtn) {
                viewActionsBtn.addEventListener('click', async () => {
                    const reportIdEl2 = document.getElementById('complianceReportId');
                    const rid2 = reportIdEl2 && reportIdEl2.value && reportIdEl2.value.trim();
                    if (!rid2) { showError('Report ID required to view actions taken'); return; }
                    try {
                        const resp = await fetchAPI(`/audit/report/${encodeURIComponent(rid2)}/actions-taken`);
                        const actions = resp && resp.actions ? resp.actions : [];
                        // Build overlay modal to show resolve steps
                        const existing = document.querySelector('.actions-taken-overlay');
                        if (existing) existing.remove();

                        const overlay = document.createElement('div');
                        overlay.className = 'actions-taken-overlay';
                        Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', right: '0', bottom: '0', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '11000' });

                        const modal = document.createElement('div');
                        Object.assign(modal.style, { background: '#fff', padding: '18px', borderRadius: '6px', maxWidth: '700px', width: '95%', maxHeight: '80vh', overflowY: 'auto' });

                        const closeBtn2 = document.createElement('button');
                        closeBtn2.innerHTML = '&times;';
                        Object.assign(closeBtn2.style, { float: 'right', border: 'none', background: 'none', fontSize: '22px', cursor: 'pointer' });
                        closeBtn2.onclick = () => overlay.remove();
                        modal.appendChild(closeBtn2);

                        const h2 = document.createElement('h3');
                        h2.textContent = 'Actions Taken';
                        modal.appendChild(h2);

                        if (!actions.length) {
                            const p = document.createElement('p');
                            p.textContent = 'No actions have been recorded yet.';
                            modal.appendChild(p);
                        } else {
                            const actionsList = document.createElement('div');
                            actionsList.className = 'actions-list';
                            actions.forEach(action => {
                                const actionItem = document.createElement('div');
                                actionItem.className = 'action-item';
                                // Prefer a full system name if provided; support both camelCase and snake_case fields
                                const fullName = action.assigneeFullName || action.assignee_full_name || action.assigneeName || action.assignee_name || 'Unknown';
                                const email = action.assigneeEmail || action.assignee_email || '';
                                actionItem.innerHTML = `
                                    <div class="action-header">
                                        <div style="display:flex; align-items:center; gap:8px; justify-content:space-between;">
                                            <div>
                                                <strong>${escapeHtml(fullName)}</strong><br/>
                                                ${email ? `<small class="muted">${escapeHtml(email)}</small>` : ''}
                                            </div>
                                            <span class="action-date">${new Date(action.timestamp).toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <div class="action-steps"><strong>Actions taken:</strong><div style="margin-top:6px;">${action.steps}</div></div>
                                `;
                                actionsList.appendChild(actionItem);
                            });
                            modal.appendChild(actionsList);
                        }

                        if (!res) {
                            const p = document.createElement('p');
                            p.textContent = 'No resolution steps recorded for this report.';
                            modal.appendChild(p);
                        } else {
                            const meta = document.createElement('div');
                            meta.innerHTML = `<small>Resolved by: ${escapeHtml(res.resolved_by_username || res.resolved_by || 'Unknown')} at ${res.resolved_at || 'Unknown'}</small>`;
                            modal.appendChild(meta);
                            const pre = document.createElement('pre');
                            pre.style.whiteSpace = 'pre-wrap';
                            pre.style.marginTop = '10px';
                            pre.textContent = res.resolve_steps || '';
                            modal.appendChild(pre);
                        }

                        overlay.appendChild(modal);
                        document.body.appendChild(overlay);
                    } catch (err) {
                        console.error('Failed to load actions taken:', err);
                        showError('Failed to load actions taken');
                    }
                });
            }
            
            if (submitBtn) {
                submitBtn.addEventListener('click', async () => {
                    const reportIdEl = modalEl.querySelector('#complianceReportId');
                    const rid = reportIdEl && reportIdEl.value && reportIdEl.value.trim();
                    if (!rid) {
                        showError('Please enter a report ID');
                        return;
                    }

                    // Ask for confirmation before submitting compliance results
                    const confirmed = window.confirm('Submit compliance check results for report ' + rid + '?\n\nChoose Continue to submit, or Cancel to return.');
                    if (!confirmed) {
                        // User cancelled; do not submit
                        return;
                    }

                    // Build standards payload (include only standards selected via checkbox)
                    const entries = Array.from(modalEl.querySelectorAll('.standard-entry'));
                    const payloadStandards = [];
                    for (const entry of entries) {
                        const sid = entry.getAttribute('data-standard-id');
                        const applyCb = entry.querySelector(`.std-apply[data-std-id="${sid}"]`);
                        if (!applyCb || !applyCb.checked) continue; // only include applied standards

                        const radios = entry.querySelectorAll(`input[name=std_result_${sid}]`);
                        let result = 'compliant';
                        radios.forEach(r => { if (r.checked) result = r.value; });
                        const notesEl = entry.querySelector('.std-notes');
                        const notes = notesEl ? notesEl.value.trim() : '';
                        payloadStandards.push({ standard_id: sid, result: result, notes: notes });
                    }

                    // Determine overall status: if any non-compliant -> non-compliant
                    const overall = payloadStandards.length === 0 ? 'compliant' : (payloadStandards.some(s => s.result === 'non-compliant') ? 'non-compliant' : 'compliant');

                    try {
                        // Show explicit please-wait overlay immediately and let fetchAPI run without its overlay
                        showProcessing('Please wait...');
                        try {
                            const resp = await fetchAPI(`/audit/report/${encodeURIComponent(rid)}/compliance`, {
                                method: 'POST',
                                body: JSON.stringify({ standards: payloadStandards, overall }),
                                showProcessing: false
                            });
                            // Hide processing before showing the success message so it disappears as the alert/notification appears
                            try { hideProcessing(); } catch (e) { /* swallow */ }
                            // Stored successfully server-side; show success and refresh the page
                            showSuccess('Compliance results submitted');
                            // Close this modal instance if present
                            try {
                                const closeBtn = modalEl.querySelector('.close-modal');
                                if (closeBtn) closeBtn.click();
                            } catch (e) { /* ignore */ }
                            // Refresh the whole page so dashboards reflect new compliance entries
                            // Use a short timeout so the success message is visible briefly
                            setTimeout(() => { window.location.reload(); }, 300);
                        } catch (err) {
                            try { hideProcessing(); } catch (e) { /* swallow */ }
                            throw err;
                        }
                    } catch (err) {
                        console.error('Failed to submit compliance results:', err);
                        showError(err.message || 'Failed to submit compliance results');
                    }
                });
            }
        }, 80);
    }

    //   --- Generate Report ---
    document.getElementById('generateReportBtn').addEventListener('click', async () => {
        const startDate = document.getElementById('reportStartDate').value;
        const endDate = document.getElementById('reportEndDate').value;

        if (!startDate || !endDate) {
            showError('Please select both a start and end date.');
            return;
        }

        try {
            // Use the API helper with the same base 
            const response = await fetchAPI('/audit/generate-report', {
                method: 'POST',
                body: JSON.stringify({ start_date: startDate, end_date: endDate }),
                // fetchAPI returns the blob directly if the response is not JSON
            });
            const blob = await response.blob(); // Assuming the raw response is what we need
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `Compliance_Report_${startDate}_to_${endDate}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            showError(error.message);
        }
    });

    // Show actions taken modal for a report
    async function showActionsTakenModal(reportId) {
        try {
            const resp = await fetchAPI(`/audit/report/${reportId}/actions-taken`);
            const actions = resp && resp.actions || [];

            const modalContent = `
                <div class="actions-taken-modal">
                    <h2>Actions Taken</h2>
                    ${actions.length ? `
                        <div class="actions-list">
                            ${actions.map(action => `
                                <div class="action-item">
                                    <div class="action-header">
                                        <strong>${action.assigneeName}</strong>
                                        <span class="action-date">${new Date(action.timestamp).toLocaleString()}</span>
                                    </div>
                                    <div class="action-steps">${action.steps}</div>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<p>No actions recorded yet.</p>'}
                </div>
            `;

            showModal(modalContent, { closable: true, size: 'small' });
        } catch (err) {
            showError('Failed to load actions taken: ' + err.message);
        }
    }

    // List submitted reports in a modal, each with a button to start a compliance check
    function openReportsListModal(reports, standards) {
        const rows = (Array.isArray(reports) ? reports : []).map(r => {
            const title = r.title || 'Untitled';
            const severityText = r.severity || 'Unknown';
            const statusText = r.status || 'Unknown';
            const createdAt = r.created_at ? new Date(r.created_at).toLocaleString() : '';
            let complianceBadge = '';
            if (r.latest_compliance_status) {
                const status = r.latest_compliance_status === 'compliant' ? 'Compliant' : 'Non-compliant';
                const badgeClass = r.latest_compliance_status === 'compliant' ? 'badge-compliant' : 'badge-noncompliant';
                const ts = r.latest_compliance_at ? new Date(r.latest_compliance_at).toLocaleString() : '';
                complianceBadge = `<span class="compliance-badge ${badgeClass}" title="Checked: ${ts}">${status}</span>`;
            } else {
                complianceBadge = `<span class="compliance-badge badge-unchecked" title="No compliance check">Unchecked</span>`;
            }

            return `<tr data-report-id="${r.report_id}">
                        <td>${title}</td>
                        <td><span class="status-badge ${String(severityText).toLowerCase().replace(/\s+/g,'-')}">${severityText}</span></td>
                        <td>${statusText} ${complianceBadge}</td>
                        <td>${createdAt}</td>
                        <td>
                            <div class="button-group">
                                <button class="btn btn-info view-actions-btn" data-report-id="${r.report_id}">
                                    <i class="fas fa-list-ul"></i> Actions Taken
                                </button>
                                <button class="btn btn-primary start-compliance-btn" data-report-id="${r.report_id}">
                                        <i class="fas fa-clipboard-check"></i> Run Compliance Check
                                </button>
                            </div>
                        </td>
                    </tr>`;
        }).join('');

        const content = `
            <h2>Submitted Reports</h2>
            <div class="reports-list">
                <table class="table full-width">
                    <thead><tr><th>Title</th><th>Severity</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
                    <tbody>
                        ${rows || '<tr><td colspan="5" style="text-align:center;">No reports found.</td></tr>'}
                    </tbody>
                </table>
            </div>
            <div style="margin-top:1rem; text-align:right;"><button class="btn btn-secondary close-reports-list">Close</button></div>
        `;

        const modalEl = showModal(content, { closable: true, size: 'large' });

        // Attach listeners for buttons within this modal only
        setTimeout(() => {
            // Attach Check Compliance button listeners
            const complianceButtons = Array.from(modalEl.querySelectorAll('.start-compliance-btn'));
            complianceButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const rid = btn.getAttribute('data-report-id');
                    // Do NOT close the reports-list modal; allow modals to overlay each other
                    // Open the compliance modal pre-filled with the selected report id (overlays)
                    openComplianceModal(standards, rid);
                });
            });

            // Attach Actions Taken button listeners
            const actionButtons = Array.from(modalEl.querySelectorAll('.view-actions-btn'));
            actionButtons.forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const rid = btn.getAttribute('data-report-id');
                    try {
                        // The server stores resolution records under admin routes; request the latest resolution
                        const resp = await fetchAPI(`/admin/reports/${encodeURIComponent(rid)}/resolution`);
                        const res = resp && resp.resolution ? resp.resolution : null;

                        // Build overlay modal to show resolution steps
                        const existing = document.querySelector('.actions-taken-overlay');
                        if (existing) existing.remove();

                        const overlay = document.createElement('div');
                        overlay.className = 'actions-taken-overlay';
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
                            zIndex: '11000' 
                        });

                        const modal = document.createElement('div');
                        Object.assign(modal.style, { 
                            background: '#fff', 
                            padding: '18px', 
                            borderRadius: '6px', 
                            maxWidth: '700px', 
                            width: '95%', 
                            maxHeight: '80vh', 
                            overflowY: 'auto' 
                        });

                        const closeBtn = document.createElement('button');
                        closeBtn.innerHTML = '&times;';
                        Object.assign(closeBtn.style, { 
                            float: 'right', 
                            border: 'none', 
                            background: 'none', 
                            fontSize: '22px', 
                            cursor: 'pointer' 
                        });
                        closeBtn.onclick = () => overlay.remove();
                        modal.appendChild(closeBtn);

                        const h3 = document.createElement('h3');
                        h3.textContent = 'Actions Taken / Resolution';
                        modal.appendChild(h3);

                        // Note: the actions list above contains per-action details. If server also provided a single
                        // resolution object it can be appended here; otherwise we skip. Try to safely read `resp.resolution`.
                        const resolution = resp && resp.resolution ? resp.resolution : null;
                        if (!resolution) {
                            const p = document.createElement('p');
                            p.textContent = 'No resolution steps recorded for this report.';
                            modal.appendChild(p);
                        } else {
                            const meta = document.createElement('div');
                            meta.className = 'action-header';
                            const resolver = resolution.resolved_by_username || resolution.resolved_by || 'Unknown';
                            const resolvedAt = resolution.resolved_at ? new Date(resolution.resolved_at).toLocaleString() : '';
                            meta.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><div><strong>${escapeHtml(resolver)}</strong><br/></div><span class=\"action-date\">${resolvedAt}</span></div>`;
                            modal.appendChild(meta);
                            const preLabel = document.createElement('h4');
                            preLabel.textContent = 'Actions taken:';
                            preLabel.style.marginTop = '12px';
                            modal.appendChild(preLabel);
                            const pre = document.createElement('pre');
                            pre.style.whiteSpace = 'pre-wrap';
                            pre.style.marginTop = '6px';
                            pre.textContent = resolution.resolve_steps || '';
                            modal.appendChild(pre);
                        }

                        overlay.appendChild(modal);
                        document.body.appendChild(overlay);
                    } catch (err) {
                        console.error('Failed to load actions taken:', err);
                        showError('Failed to load actions taken');
                    }
                });
            });

            const closeBtn = modalEl.querySelector('.close-reports-list');
            if (closeBtn) closeBtn.addEventListener('click', () => {
                const closeModalBtn = modalEl.querySelector('.close-modal');
                if (closeModalBtn) closeModalBtn.click();
            });
        }, 50);
    }

    // (showError & showSuccess defined above and used throughout)

    // Initial load of statistics
    fetchStats();
});
