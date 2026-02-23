document.addEventListener('DOMContentLoaded', () => {
    const standardsBtn = document.getElementById('standardsBtn');
    const standardsModal = document.getElementById('standardsModal');
    const closeStandardsModal = document.getElementById('closeStandardsModal');
    const standardsTableBody = document.querySelector('#standardsTable tbody');
    const openAddStandardBtn = document.getElementById('openAddStandardBtn');
    const standardEditModal = document.getElementById('standardEditModal');
    const closeStandardEditModal = document.getElementById('closeStandardEditModal');
    const standardForm = document.getElementById('standardForm');
    const standardEditTitle = document.getElementById('standardEditTitle');
    const standardFormMessage = document.getElementById('standardFormMessage');
    const cancelStandardBtn = document.getElementById('cancelStandardBtn');

    let editingId = null; // null -> creating new

    function openModal(modal) {
        if (!modal) return;
        modal.style.display = 'flex';
        modal.classList.add('active');
        modal.removeAttribute('aria-hidden');
        modal.style.zIndex = '12500';
        document.body.style.overflow = 'hidden';
    }
    function closeModal(modal) {
        if (!modal) return;
        modal.classList.remove('active');
        modal.style.display = '';
        modal.setAttribute('aria-hidden', 'true');
        modal.style.zIndex = '';
        document.body.style.overflow = '';
    }

    async function loadStandards() {
        try {
            if (standardsTableBody) standardsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:12px">Loading...</td></tr>';
            const data = await fetchAPI('/admin/compliance/standards');
            const items = (data && data.standards) ? data.standards : [];
            if (!items || items.length === 0) {
                if (standardsTableBody) standardsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:12px">No standards found</td></tr>';
                return;
            }
            if (standardsTableBody) standardsTableBody.innerHTML = '';
            items.forEach(s => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${escapeHtml(s.control_id || '')}</td>
                    <td>${escapeHtml(s.name || '')}</td>
                    <td>${escapeHtml(s.description || '')}</td>
                    <td>
                        <button class="btn btn-outline standards-edit" data-id="${escapeHtml(s._id)}">Edit</button>
                        <button class="btn btn-danger standards-delete" data-id="${escapeHtml(s._id)}">Delete</button>
                    </td>
                `;
                standardsTableBody.appendChild(tr);
            });

            document.querySelectorAll('.standards-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (!id) return;
                    if (!confirm('Delete this standard? This cannot be undone.')) return;
                    try {
                        await fetchAPI(`/admin/compliance/standards/${id}`, { method: 'DELETE' });
                        await loadStandards();
                    } catch (err) {
                        alert(err.message || 'Failed to delete standard');
                    }
                });
            });

            document.querySelectorAll('.standards-edit').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    if (!id) return;
                    try {
                        const data = await fetchAPI(`/admin/compliance/standards/${id}`);
                        // endpoint returns the document
                        const doc = data && data.standard ? data.standard : data;
                        editingId = id;
                        standardEditTitle.textContent = 'Edit Standard';
                        document.getElementById('standardControlId').value = doc.control_id || '';
                        document.getElementById('standardName').value = doc.name || '';
                        document.getElementById('standardDescription').value = doc.description || '';
                        standardFormMessage.textContent = '';
                        openModal(standardEditModal);
                    } catch (err) {
                        alert(err.message || 'Failed to load standard');
                    }
                });
            });
        } catch (err) {
            console.error('loadStandards error', err);
            if (standardsTableBody) standardsTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#c00">${escapeHtml(err.message || 'Failed to load')}</td></tr>`;
        }
    }

    standardsBtn && standardsBtn.addEventListener('click', async () => {
        openModal(standardsModal);
        await loadStandards();
    });
    closeStandardsModal && closeStandardsModal.addEventListener('click', () => closeModal(standardsModal));

    openAddStandardBtn && openAddStandardBtn.addEventListener('click', (e) => {
        editingId = null;
        standardEditTitle.textContent = 'Add Standard';
        standardForm.reset();
        standardFormMessage.textContent = '';
        openModal(standardEditModal);
    });

    closeStandardEditModal && closeStandardEditModal.addEventListener('click', () => closeModal(standardEditModal));
    cancelStandardBtn && cancelStandardBtn.addEventListener('click', () => closeModal(standardEditModal));

    // Close when clicking outside modal-content
    if (standardsModal) {
        standardsModal.addEventListener('click', (e) => {
            if (e.target === standardsModal) {
                closeModal(standardsModal);
            }
        });
    }
    if (standardEditModal) {
        standardEditModal.addEventListener('click', (e) => {
            if (e.target === standardEditModal) {
                closeModal(standardEditModal);
            }
        });
    }

    standardForm && standardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        standardFormMessage.textContent = '';
        const control_id = (document.getElementById('standardControlId').value || '').trim();
        const name = (document.getElementById('standardName').value || '').trim();
        const description = (document.getElementById('standardDescription').value || '').trim();
        if (!control_id || !name) {
            standardFormMessage.textContent = 'Control ID and Name are required';
            standardFormMessage.className = 'form-message alert alert-error';
            return;
        }
        try {
            const payload = { control_id, name, description };
            if (editingId) {
                await fetchAPI(`/admin/compliance/standards/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
            } else {
                await fetchAPI('/admin/compliance/standards', { method: 'POST', body: JSON.stringify(payload) });
            }
            closeModal(standardEditModal);
            await loadStandards();
        } catch (err) {
            standardFormMessage.textContent = err.message || 'Failed to save standard';
            standardFormMessage.className = 'form-message alert alert-error';
        }
    });

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
});
