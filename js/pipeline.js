// js/pipeline.js — Visual Deduplication Pipeline

export class PipelineVisualizer {
  constructor() {
    this.container = null;
    this.stages = [
      { id: 'import', label: 'Import', icon: '📥' },
      { id: 'normalize', label: 'Normalize', icon: '🔧' },
      { id: 'bloom', label: 'Bloom Filter', icon: '🔮' },
      { id: 'compare', label: 'Compare', icon: '🔍' },
      { id: 'classify', label: 'Classify', icon: '🏷️' },
      { id: 'store', label: 'Store/Reject', icon: '💾' }
    ];
  }

  init(container) {
    this.container = container;
    this._render();
  }

  _render() {
    this.container.innerHTML = `
      <div class="card mb-lg">
        <div class="card-header">
          <h2 class="card-title">Deduplication Pipeline Status</h2>
        </div>
        
        <div class="pipeline" id="pipeline-flow">
          ${this.stages.map((stage, i) => `
            <div class="pipeline-stage" id="stage-${stage.id}">
              <div class="stage-icon">${stage.icon}</div>
              <div class="stage-label">${stage.label}</div>
              <div class="stage-count" id="count-${stage.id}">0</div>
            </div>
            ${i < this.stages.length - 1 ? `
              <div class="pipeline-connector" id="conn-${stage.id}">
                <div class="connector-dot"></div>
              </div>
            ` : ''}
          `).join('')}
        </div>
      </div>

      <div class="card-grid mb-lg" id="pipeline-results" style="display:none">
        <div class="stat-card info"><div class="stat-label">Processed</div><div class="stat-value" id="res-total">0</div></div>
        <div class="stat-card success"><div class="stat-label">Unique Added</div><div class="stat-value" id="res-unique">0</div></div>
        <div class="stat-card warning"><div class="stat-label">Probable Dups</div><div class="stat-value" id="res-probable">0</div></div>
        <div class="stat-card danger"><div class="stat-label">Confirmed Dups</div><div class="stat-value" id="res-duplicate">0</div></div>
      </div>

      <div class="card">
        <h3 class="card-title mb-md">Execution Log</h3>
        <div class="pipeline-log" id="pipeline-log">
          <div class="text-muted" style="text-align:center; padding: 20px;">Awaiting data import...</div>
        </div>
      </div>
    `;
  }

  async animatePipeline(records, results) {
    const totalRecords = records.length;
    let unique = 0, probable = 0, duplicate = 0;
    
    document.getElementById('pipeline-log').innerHTML = ''; // Clear log
    document.getElementById('pipeline-results').style.display = 'none';

    // 1. Import
    await this._activateStage('import', totalRecords);
    this._addLog(`Imported ${totalRecords} records for processing`);
    await this._delay(600);
    this._animateConnector('import');
    
    // 2. Normalize
    await this._activateStage('normalize', totalRecords);
    this._addLog(`Normalized ${totalRecords} records (casing, whitespace, special chars)`);
    await this._delay(600);
    this._animateConnector('normalize');
    
    // 3. Bloom Filter
    const bloomFlagged = results.filter(r => r.bloomResult === 'flagged').length;
    const bloomPassed = totalRecords - bloomFlagged;
    await this._activateStage('bloom', totalRecords);
    this._addLog(`Bloom Filter pre-screening: ${bloomPassed} passed instantly, ${bloomFlagged} flagged for deep comparison`);
    await this._delay(800);
    this._animateConnector('bloom');
    
    // 4. Compare
    await this._activateStage('compare', bloomFlagged || totalRecords);
    this._addLog(`Running Levenshtein, Jaro-Winkler, N-gram, and Soundex on candidate pairs`);
    await this._delay(800);
    this._animateConnector('compare');
    
    // 5. Classify
    for (const result of results) {
      if (result.classification === 'unique') unique++;
      else if (result.classification === 'probable') probable++;
      else if (result.classification === 'duplicate') duplicate++;
    }
    await this._activateStage('classify', totalRecords);
    this._addLog(`Classification complete: ${unique} unique, ${probable} probable, ${duplicate} confirmed duplicates`);
    await this._delay(600);
    this._animateConnector('classify');
    
    // 6. Store
    await this._activateStage('store', unique);
    this._addLog(`Stored ${unique} records in Database. Sent ${probable + duplicate} to Resolution Center.`);
    await this._delay(400);
    
    this._completeAllStages();
    
    // Show results
    document.getElementById('pipeline-results').style.display = 'grid';
    document.getElementById('res-total').textContent = totalRecords;
    document.getElementById('res-unique').textContent = unique;
    document.getElementById('res-probable').textContent = probable;
    document.getElementById('res-duplicate').textContent = duplicate;
  }

  async _activateStage(stageId, count) {
    document.querySelectorAll('.pipeline-stage').forEach(el => el.classList.remove('active'));
    document.getElementById(`stage-${stageId}`).classList.add('active');
    
    const countEl = document.getElementById(`count-${stageId}`);
    countEl.textContent = count;
  }

  _animateConnector(sourceStageId) {
    const conn = document.getElementById(`conn-${sourceStageId}`);
    if (conn) {
      conn.classList.add('animating');
      setTimeout(() => conn.classList.remove('animating'), 1000);
    }
  }

  _completeAllStages() {
    document.querySelectorAll('.pipeline-stage').forEach(el => {
      el.classList.remove('active');
      el.classList.add('completed');
    });
  }

  _addLog(message) {
    const logContainer = document.getElementById('pipeline-log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-message">${message}</span>`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  reset() {
    this._render();
  }

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
}
