// js/audit.js — Audit Trail UI Controller

export class AuditTrail {
  constructor(db) {
    this.db = db; 
    this.container = null;
    this.currentFilter = 'all';
  }

  init(container) {
    this.container = container;
  }

  async log(action, details, recordId = null) {
    await this.db.addAuditLog(action, details, recordId);
  }

  async render() {
    if (!this.container) return;
    
    this.container.innerHTML = `
      <div class="card mb-lg">
        <div class="card-header">
          <h2 class="card-title">System Audit Log</h2>
          <div class="flex gap-sm">
            <button class="btn btn-secondary btn-sm" id="btn-export-audit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-sm"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export JSON
            </button>
          </div>
        </div>
        
        <div class="audit-filters mt-md mb-md flex gap-sm" style="flex-wrap: wrap;">
          ${this._renderFilterBtn('all', 'All Activity')}
          ${this._renderFilterBtn('import', 'Imports')}
          ${this._renderFilterBtn('classify_unique', 'Uniques')}
          ${this._renderFilterBtn('classify_duplicate', 'Duplicates')}
          ${this._renderFilterBtn('merge', 'Merges')}
          ${this._renderFilterBtn('discard', 'Discards')}
          ${this._renderFilterBtn('mark_false_positive', 'False Positives')}
        </div>
        
        <div class="audit-list" id="audit-list"></div>
      </div>
    `;

    document.getElementById('btn-export-audit').addEventListener('click', () => this.exportJSON());
    
    const filterBtns = this.container.querySelectorAll('.audit-filter');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.filter(e.target.dataset.filter);
      });
    });

    const logs = await this.db.getAuditLogs(this.currentFilter);
    const listEl = document.getElementById('audit-list');
    
    if (logs.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state mt-lg mb-lg">
          <div class="empty-icon text-muted" style="font-size: 48px; margin-bottom: 16px;">📝</div>
          <h3>No activity found</h3>
          <p class="text-muted">No audit logs match the current filter.</p>
        </div>
      `;
      return;
    }

    logs.forEach(log => {
      const entry = document.createElement('div');
      entry.className = 'audit-entry flex gap-md align-center';
      entry.style.padding = '12px';
      entry.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      
      const timeStr = this._formatTimestamp(log._timestamp);
      const icon = this._getActionIcon(log.action);
      const tagClass = this._getActionTagClass(log.action);
      const recordTag = log.recordId ? `<span class="tag" style="background: rgba(255,255,255,0.1); margin-left: auto;">ID: ${log.recordId.substring(0,8)}</span>` : '';

      entry.innerHTML = `
        <div class="audit-time text-muted" style="font-family: monospace; font-size: 13px; width: 140px;">${timeStr}</div>
        <div class="audit-icon" style="font-size: 18px;">${icon}</div>
        <div class="audit-tag"><span class="tag ${tagClass}">${log.action.replace(/_/g, ' ').toUpperCase()}</span></div>
        <div class="audit-details flex-grow">${log.details}</div>
        ${recordTag}
      `;
      
      listEl.appendChild(entry);
    });
  }

  _renderFilterBtn(filter, label) {
    const activeClass = this.currentFilter === filter ? 'active btn-primary' : 'btn-secondary';
    return `<button class="btn btn-sm audit-filter ${activeClass}" data-filter="${filter}">${label}</button>`;
  }

  async filter(actionType) {
    this.currentFilter = actionType;
    await this.render();
  }

  async exportJSON() {
    const logs = await this.db.getAuditLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `datapurge-audit-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.log('export', 'Exported audit logs to JSON file');
    window.showToast('Audit log exported', 'success');
  }

  _formatTimestamp(ts) {
    const d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  _getActionIcon(action) {
    const icons = {
      import: '📥', classify_unique: '✅', classify_duplicate: '❌', classify_probable: '⚠️',
      merge: '🔀', discard: '🗑️', keep_both: '📋', mark_false_positive: '🔍',
      delete: '🗑️', clear: '🧹', export: '📤'
    };
    return icons[action] || '📝';
  }

  _getActionTagClass(action) {
    if (['classify_unique', 'merge'].includes(action)) return 'tag-unique';
    if (['classify_probable', 'keep_both'].includes(action)) return 'tag-probable';
    if (['classify_duplicate', 'discard', 'delete', 'clear'].includes(action)) return 'tag-duplicate';
    if (['mark_false_positive'].includes(action)) return 'tag-false-positive';
    return 'tag-unique';
  }
}
