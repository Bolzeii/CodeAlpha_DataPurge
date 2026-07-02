// js/resolver.js — Duplicate Resolution Center

export class ResolutionCenter {
  constructor(db, audit, onResolve) {
    this.db = db;
    this.audit = audit;
    this.onResolve = onResolve; 
    this.container = null;
  }

  init(container) {
    this.container = container;
  }

  async render() {
    if (!this.container) return;
    this.container.innerHTML = '';
    
    const duplicates = await this.db.getAllDuplicates('pending');
    
    if (duplicates.length === 0) {
      this._renderEmptyState();
      return;
    }
    
    // Header & Batch Actions
    const header = document.createElement('div');
    header.className = 'flex justify-between align-center mb-lg';
    header.innerHTML = `
      <div>
        <h2 class="page-title">Resolution Center</h2>
        <p class="text-muted">${duplicates.length} duplicate pairs pending review</p>
      </div>
      <div class="btn-group">
        <button class="btn btn-secondary btn-sm" id="btn-batch-fp">Mark All as False Positive</button>
        <button class="btn btn-danger btn-sm" id="btn-batch-discard">Discard All New</button>
      </div>
    `;
    this.container.appendChild(header);

    document.getElementById('btn-batch-fp').addEventListener('click', () => this._batchResolve('false_positive'));
    document.getElementById('btn-batch-discard').addEventListener('click', () => this._batchResolve('discard'));
    
    // Render Cards
    for (const dup of duplicates) {
      this.container.appendChild(this._createComparisonCard(dup));
    }
  }

  _createComparisonCard(dup) {
    const card = document.createElement('div');
    card.className = 'card comparison-card mb-lg';
    
    // Header with Confidence
    const tagClass = dup.classification === 'duplicate' ? 'tag-duplicate' : 'tag-probable';
    const tagText = dup.classification === 'duplicate' ? 'Confirmed Duplicate' : 'Probable Duplicate';
    
    let headerHtml = `
      <div class="flex justify-between align-center">
        <h3 class="card-title m-0">Duplicate Detection</h3>
        <span class="tag ${tagClass}">${tagText}</span>
      </div>
      <div class="confidence-bar-wrap">
        <div class="confidence-fill" style="width: ${dup.confidence}%"></div>
      </div>
      <div class="flex justify-between text-muted" style="font-size: 12px">
        <span>Confidence Score: <strong style="color:white">${dup.confidence}%</strong></span>
        <span>ID: ${dup._id.substring(0,8)}</span>
      </div>
    `;

    // Comparison Grid
    const newRec = dup.newRecord;
    const oldRec = dup.matchedRecord;
    const fields = Object.keys(newRec).filter(k => !k.startsWith('_'));
    
    let leftHtml = `<div class="comparison-side"><div class="comparison-side-title">New Record (Incoming)</div>`;
    let rightHtml = `<div class="comparison-side"><div class="comparison-side-title">Existing Record (Database)</div>`;
    
    fields.forEach(f => {
      const val1 = newRec[f] || '';
      const val2 = oldRec[f] || '';
      const differs = val1.toLowerCase().trim() !== val2.toLowerCase().trim() ? 'differs' : '';
      
      leftHtml += `
        <div class="comparison-field ${differs}">
          <div class="field-label">${f}</div>
          <div class="field-value">${val1 || '<em class="text-muted">Empty</em>'}</div>
        </div>
      `;
      rightHtml += `
        <div class="comparison-field ${differs}">
          <div class="field-label">${f}</div>
          <div class="field-value">${val2 || '<em class="text-muted">Empty</em>'}</div>
        </div>
      `;
    });
    
    leftHtml += `</div>`;
    rightHtml += `</div>`;
    
    const gridHtml = `<div class="comparison-grid mt-md">${leftHtml}${rightHtml}</div>`;
    
    // Action Bar
    const actionHtml = `
      <div class="action-bar">
        <button class="btn btn-secondary btn-sm action-btn" data-action="false_positive">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-sm"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> False Positive
        </button>
        <button class="btn btn-danger btn-sm action-btn" data-action="discard">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-sm"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Discard New
        </button>
        <button class="btn btn-primary btn-sm action-btn" data-action="merge">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-sm"><path d="M6 18v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3"/><polyline points="15 15 18 18 21 15"/><circle cx="12" cy="7" r="4"/></svg> Merge Best
        </button>
      </div>
    `;

    card.innerHTML = headerHtml + gridHtml + actionHtml;

    // Attach listeners
    card.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = e.currentTarget.dataset.action;
        e.currentTarget.disabled = true;
        
        if (action === 'merge') await this._handleMerge(dup);
        else if (action === 'discard') await this._handleDiscard(dup);
        else if (action === 'false_positive') await this._handleFalsePositive(dup);
      });
    });

    return card;
  }

  async _handleMerge(dup) {
    const merged = { ...dup.matchedRecord };
    // Fill empty fields in existing with values from new
    Object.keys(dup.newRecord).forEach(k => {
      if (!k.startsWith('_') && (!merged[k] || merged[k].trim() === '') && dup.newRecord[k]) {
        merged[k] = dup.newRecord[k];
      }
    });
    
    await this.db.addRecord(merged, dup.matchedRecord._hash); // Keep original hash/id
    await this.db.resolveDuplicate(dup._id, 'merged');
    await this.audit.log('merge', `Merged record ${dup.newRecord._id || 'new'} into ${dup.matchedRecord._id}`, dup.matchedRecord._id);
    window.showToast('Records merged successfully', 'success');
    
    await this.render();
    if (this.onResolve) this.onResolve();
  }

  async _handleDiscard(dup) {
    await this.db.resolveDuplicate(dup._id, 'discarded');
    await this.audit.log('discard', `Discarded duplicate record`, dup.matchedRecord._id);
    window.showToast('Duplicate discarded', 'info');
    
    await this.render();
    if (this.onResolve) this.onResolve();
  }

  async _handleFalsePositive(dup) {
    // Treat as unique
    const hash = 'fp_' + Date.now() + Math.random(); 
    await this.db.addRecord(dup.newRecord, hash);
    await this.db.resolveDuplicate(dup._id, 'false_positive');
    await this.audit.log('mark_false_positive', `Marked as false positive and added as unique`, dup.newRecord._id);
    window.showToast('Marked as false positive and saved', 'success');
    
    await this.render();
    if (this.onResolve) this.onResolve();
  }

  _renderEmptyState() {
    this.container.innerHTML = `
      <div class="empty-state mt-lg mb-lg flex flex-col align-center" style="padding: 60px 20px; text-align: center;">
        <div class="empty-icon text-success" style="font-size: 64px; margin-bottom: 24px;">✨</div>
        <h2 style="font-size: 24px; margin-bottom: 8px;">All Clear!</h2>
        <p class="text-muted" style="font-size: 16px;">No duplicate records are currently pending review.</p>
      </div>
    `;
  }

  async _batchResolve(action) {
    const duplicates = await this.db.getAllDuplicates('pending');
    let count = 0;
    for (const dup of duplicates) {
      if (action === 'discard') {
        await this.db.resolveDuplicate(dup._id, 'discarded');
      } else if (action === 'false_positive') {
        const hash = 'fp_' + Date.now() + Math.random(); 
        await this.db.addRecord(dup.newRecord, hash);
        await this.db.resolveDuplicate(dup._id, 'false_positive');
      }
      count++;
    }
    
    if (action === 'discard') {
      await this.audit.log('discard', `Batch discarded ${count} new records`);
      window.showToast(`Discarded ${count} duplicates`, 'info');
    } else {
      await this.audit.log('mark_false_positive', `Batch marked ${count} records as false positive`);
      window.showToast(`Marked ${count} as false positive`, 'success');
    }
    
    await this.render();
    if (this.onResolve) this.onResolve();
  }
}
