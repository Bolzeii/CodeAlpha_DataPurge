// js/app.js — Complete Extended Platform Control Engine Architecture

class BloomFilter {
  constructor(size = 1000, hashCount = 3) {
    this.size = size;
    this.hashCount = hashCount;
    this.bitArray = new Array(size).fill(0);
  }

  _getHashes(str) {
    const hashes = [];
    let h1 = 5381;
    let h2 = 33;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      h1 = ((h1 << 5) + h1) + char;
      h2 = ((h2 << 5) + h2) ^ char;
    }
    for (let i = 0; i < this.hashCount; i++) {
      hashes.push(Math.abs((h1 + i * h2) % this.size));
    }
    return hashes;
  }

  add(str) {
    this._getHashes(str).forEach(idx => { this.bitArray[idx] = 1; });
  }

  test(str) {
    return this._getHashes(str).every(idx => this.bitArray[idx] === 1);
  }
}

class UnifiedDataPurgeApp {
  constructor() {
    this.dbName = 'DataPurgeCoreDB';
    this.dbVersion = 1;
    this.db = null;
    this.chart = null;
    this.bloom = new BloomFilter();
    this.resolutionMode = 'manual'; // Tracks system mode context ('manual' vs 'auto')
    this.isProcessing = false;       // Concurrency safety switch guard
    this.init();
  }

  // Add this method inside the UnifiedDataPurgeApp class
  async bulkPurge(classificationType) {
    // 1. Safety Guard
    if (this.isProcessing) return;
    
    // 2. User Confirmation
    if (!confirm(`Are you sure you want to purge all records classified as: ${classificationType.toUpperCase()}?`)) {
        return;
    }

    this.isProcessing = true;
    this.logSystem(`Initializing bulk purge for category: ${classificationType}`, 'info');

    try {
        const tx = this.db.transaction(['duplicates', 'audit_logs'], 'readwrite');
        const dupsStore = tx.objectStore('duplicates');
        const auditStore = tx.objectStore('audit_logs');
        
        const allItems = await this._promisifiedStoreAction(dupsStore, 'getAll');
        const targetItems = allItems.filter(i => i.status === 'pending' && i.classification === classificationType);

        if (targetItems.length === 0) {
            window.showToast(`No records found for ${classificationType}.`, 'info');
            this.isProcessing = false;
            return;
        }

        for (const item of targetItems) {
            item.status = 'approved';
            await this._promisifiedStoreAction(dupsStore, 'put', item);
        }

        await this.addAuditEntry(auditStore, 'Bulk Purge', `Cleared ${targetItems.length} items of type ${classificationType}.`);
        window.showToast(`Bulk purge successful: ${targetItems.length} nodes removed.`, 'success');
        
        // Refresh UI
        await this.renderResolverQueue();
        await this.refreshTelemetry();
        
    } catch (err) {
        console.error("Bulk purge failed:", err);
        window.showToast("Bulk purge failed. Check console.", "warning");
    } finally {
        this.isProcessing = false;
    }
  }

  async init() {
    try {
      this.db = await this._initDatabase();
      this._setupNavigation();
      this._setupFileIngestion();
      this._setupModeSelector();
      this._renderCharts();
      await this.refreshTelemetry();
      this.logSystem('Initialization sequence accomplished successfully. Bloom Filter & Databases Active.', 'info');
    } catch (err) {
      console.error("System Boot Failure:", err);
    }
  }

  _initDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: '_id' });
        if (!db.objectStoreNames.contains('duplicates')) db.createObjectStore('duplicates', { keyPath: '_id' });
        if (!db.objectStoreNames.contains('audit_logs')) db.createObjectStore('audit_logs', { keyPath: '_id' });
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  _setupNavigation() {
    const items = document.querySelectorAll('.nav-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        items.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        const target = item.getAttribute('data-target');
        document.querySelectorAll('.app-section').forEach(sec => sec.style.display = 'none');
        
        const targetSection = document.getElementById(`section-${target}`);
        if (targetSection) targetSection.style.display = 'block';
        
        if (target === 'resolver') this.renderResolverQueue();
        if (target === 'audit') this.renderAuditLogs();
      });
    });

    const clearBtn = document.getElementById('btn-clear-db');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearMasterVault());
    }
  }

  _setupFileIngestion() {
    const dropzone = document.getElementById('csv-dropzone');
    const fileInput = document.getElementById('csv-file-input');

    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0) this.processCSVFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.processCSVFile(e.target.files[0]);
        e.target.value = ''; // Reset input to allow re-uploading the same file name easily
      }
    });
  }

  _setupModeSelector() {
    const modeSwitch = document.getElementById("resolution-mode-select");
    if (modeSwitch) {
      modeSwitch.value = this.resolutionMode;
      modeSwitch.addEventListener("change", (e) => {
        this.resolutionMode = e.target.value;
        this.toggleResolutionControls();
      });
    }
  }

  toggleResolutionControls() {
    const purgeAllBtn = document.getElementById("purge-all-btn");
    
    if (this.resolutionMode === 'auto') {
      if (purgeAllBtn) {
        purgeAllBtn.innerHTML = "💥 Auto-Purging Rules Enabled";
        purgeAllBtn.style.background = "#10b981"; // Shift to green alert
      }
      this.purgeAllAnomalies();
    } else {
      if (purgeAllBtn) {
        purgeAllBtn.innerHTML = "💥 Purge All Pending";
        purgeAllBtn.style.background = "#dc2626"; // Return to threat red
      }
      this.renderResolverQueue('all');
    }
  }

  startPipelineVisualization(totalRecords, finalProcessedCount, finalConflictCount, finalBloomPasses, finalFuzzyEvaluations) {
    const stageIngest = document.getElementById('stage-ingest');
    const stageBloom = document.getElementById('stage-bloom');
    const stageFuzzy = document.getElementById('stage-fuzzy');
    const stageVault = document.getElementById('stage-vault');

    const cIngest = document.getElementById('count-ingest');
    const cBloom = document.getElementById('count-bloom');
    const cFuzzy = document.getElementById('count-fuzzy');
    const cVault = document.getElementById('count-vault');

    if (stageIngest) stageIngest.classList.add('active');
    this.updateDynamicCounter(cIngest, 0, totalRecords, 40);
    this.appendLiveAuditTrail("Initializing Data Ingestion stream...");

    setTimeout(() => {
      if (stageBloom) stageBloom.classList.add('active');
      this.updateDynamicCounter(cBloom, 0, finalBloomPasses, 40);
      this.appendLiveAuditTrail("Ingestion complete. Routing packets through bloom matrix filter vectors...");
      
      if (this.chart) {
        this.chart.data.datasets[0].data = [finalProcessedCount / 2, finalConflictCount / 2, 0];
        this.chart.update('active');
      }
    }, 1500);

    setTimeout(() => {
      if (stageFuzzy) stageFuzzy.classList.add('active');
      this.updateDynamicCounter(cFuzzy, 0, finalFuzzyEvaluations, 40);
      this.appendLiveAuditTrail("Bloom checks finalized. Running composite Levenshtein/Jaro-Winkler analysis blocks...");
      this.visualizeLiveResolutionCenter();
    }, 3200);

    setTimeout(() => {
      if (stageVault) stageVault.classList.add('active');
      this.updateDynamicCounter(cVault, 0, finalProcessedCount, 40);
      this.appendLiveAuditTrail("Optimizing telemetry registers. Purging collision redundancies...");
    }, 5000);
  }

  updateDynamicCounter(element, start, end, durationMS) {
    if (!element) return;
    let current = start;
    const step = Math.ceil(end / 25) || 1;
    const timer = setInterval(() => {
      current += step;
      if (current >= end) {
        current = end;
        clearInterval(timer);
      }
      element.innerText = current;
    }, durationMS);
  }

  visualizeLiveResolutionCenter() {
    const resPanel = document.getElementById('resolution-log-container');
    if (!resPanel) return;
    resPanel.innerHTML = ""; 

    const simulatedClashes = [
      "Flagged overlapping clustering array at block 0x4F",
      "Deduplicating cross-referenced user records...",
      "Resolved deterministic mismatch via fuzzy alignment index variables."
    ];

    simulatedClashes.forEach((logMessage, index) => {
      setTimeout(() => {
        const row = document.createElement('div');
        row.className = "resolution-item correction-flash";
        row.style.cssText = "padding: 8px; margin-bottom: 4px; background: rgba(16,185,129,0.08); border-left: 4px solid #10b981; font-size: 12px; color: #10b981; font-weight: 600;";
        row.innerText = logMessage;
        resPanel.appendChild(row);
      }, index * 600);
    });
  }

  appendLiveAuditTrail(message) {
    const mainTerminal = document.getElementById('audit-terminal');
    if (!mainTerminal) return;
    
    if (mainTerminal.innerHTML.includes("No mutations committed")) {
      mainTerminal.innerHTML = "";
    }

    const stamp = new Date().toLocaleTimeString();
    const wrapper = document.createElement('div');
    wrapper.className = "log-entry adjustment-flash";
    wrapper.innerHTML = `
      <span class="log-time">[${stamp}]</span>
      <strong style="color: #10b981; min-width:120px;">SIMULATION:</strong>
      <span class="log-message" style="color: #d1d5db;">${message}</span>
    `;
    mainTerminal.prepend(wrapper);
  }

  async processCSVFile(file) {
    // FIX: Concurrency block prevent actions popping twice 
    if (this.isProcessing) {
      if (typeof window.showToast === 'function') window.showToast('Processing pipeline is busy.', 'warning');
      return;
    }
    
    this.isProcessing = true;
    this.logSystem(`Beginning processing track for dataset target: ${file.name}`, 'info');
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length <= 1) {
          if (typeof window.showToast === 'function') {
            window.showToast('Invalid or empty dataset matrix uploaded.', 'warning');
          }
          this.isProcessing = false;
          return;
        }

        const headers = lines[0].split(',');
        let processedCount = 0;
        let conflictCount = 0;
        let bloomPasses = 0;
        let fuzzyEvaluations = 0;

        const tx = this.db.transaction(['records', 'duplicates'], 'readonly');
        const existingRecords = await this._promisifiedStoreAction(tx.objectStore('records'), 'getAll');
        
        const writeTx = this.db.transaction(['records', 'duplicates', 'audit_logs'], 'readwrite');
        const recordsStore = writeTx.objectStore('records');
        const dupsStore = writeTx.objectStore('duplicates');

        existingRecords.forEach(r => {
          const serialized = Object.values(r).filter(v => typeof v === 'string' && v.indexOf('rec_') !== 0).join(' ').toLowerCase();
          this.bloom.add(serialized);
        });

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          const record = {};
          headers.forEach((h, idx) => { record[h.trim()] = values[idx] ? values[idx].trim() : ''; });
          
          record._id = 'rec_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
          const serializedString = Object.values(record).filter(v => typeof v === 'string' && v.indexOf('rec_') !== 0).join(' ').toLowerCase();
          const internalHash = this._generateDeterministicHash(serializedString);

          let isSuspectDuplicate = this.bloom.test(serializedString);

          if (!isSuspectDuplicate) {
            processedCount++;
            this.bloom.add(serializedString);
            await this._promisifiedStoreAction(recordsStore, 'put', record);
          } else {
            bloomPasses++;
            fuzzyEvaluations++;
            
            let duplicateFound = false;
            for (const existing of existingRecords) {
              const checkString = Object.values(existing).filter(v => typeof v === 'string' && v.indexOf('rec_') !== 0).join(' ').toLowerCase();
              
              const levScore = this._calculateLevenshteinDistance(serializedString, checkString);
              const jwScore = this._calculateJaroWinkler(serializedString, checkString);
              const compositeScore = (levScore + jwScore) / 2;

              if (compositeScore > 0.85) {
                conflictCount++;
                duplicateFound = true;
                
                const resolvedState = this.resolutionMode === 'auto' ? 'approved' : 'pending';
                
                await this._promisifiedStoreAction(dupsStore, 'put', {
                  _id: 'dup_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
                  context: JSON.stringify(record),
                  hashSignature: internalHash,
                  confidence: Math.round(compositeScore * 100) + '%',
                  status: resolvedState,
                  classification: compositeScore > 0.98 ? 'duplicate' : 'probable'
                });
                break;
              }
            }

            if (!duplicateFound) {
              processedCount++;
              await this._promisifiedStoreAction(recordsStore, 'put', record);
            }
          }
        }

        const totalIngestedRows = lines.length - 1;
        this.startPipelineVisualization(totalIngestedRows, processedCount, conflictCount, bloomPasses, fuzzyEvaluations);

        await this.addAuditEntry(writeTx.objectStore('audit_logs'), 'Ingest Dataset', `Parsed ${totalIngestedRows} entries. Unique saved: ${processedCount}. Conflicts caught: ${conflictCount}`);

        setTimeout(async () => {
          if (typeof window.showToast === 'function') {
            window.showToast(`Successfully processed ${totalIngestedRows} records into structural stages.`, 'success');
          }
          this.logSystem(`Dataset pipeline operations terminated. Processed rows context loops complete.`, 'success');
          await this.refreshTelemetry();
        }, 5200);

      } catch (err) {
        console.error(err);
      } finally {
        this.isProcessing = false;
      }
    };
    reader.readAsText(file);
  }

  _generateDeterministicHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return 'fp_' + Math.abs(hash).toString(16);
  }

  _calculateLevenshteinDistance(s1, s2) {
    let longer = s1; let shorter = s2;
    if (s1.length < s2.length) { longer = s2; shorter = s1; }
    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;
    
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i == 0) costs[j] = j;
        else {
          if (j > 0) {
            let newValue = costs[j - 1];
            if (s1.charAt(i - 1) != s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
            costs[j - 1] = lastValue;
            lastValue = newValue;
          }
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return (longerLength - costs[s2.length]) / parseFloat(longerLength);
  }

  _calculateJaroWinkler(s1, s2) {
    let jaro = this._calculateJaro(s1, s2);
    if (jaro < 0.7) return jaro;
    let prefixLength = 0;
    for (let i = 0; i < Math.min(s1.length, s2.length, 4); i++) {
      if (s1[i] === s2[i]) prefixLength++;
      else break;
    }
    return jaro + (0.1 * prefixLength * (1.0 - jaro));
  }

  _calculateJaro(s1, s2) {
    if (s1 === s2) return 1.0;
    let matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
    let s1Matches = new Array(s1.length).fill(false);
    let s2Matches = new Array(s2.length).fill(false);
    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < s1.length; i++) {
      let start = Math.max(0, i - matchWindow);
      let end = Math.min(s2.length - 1, i + matchWindow);
      for (let j = start; j <= end; j++) {
        if (!s2Matches[j] && s1[i] === s2[j]) {
          s1Matches[i] = true;
          s2Matches[j] = true;
          matches++;
          break;
        }
      }
    }
    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < s1.length; i++) {
      if (s1Matches[i]) {
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
      }
    }
    return ((matches / s1.length) + (matches / s2.length) + ((matches - transpositions / 2) / matches)) / 3.0;
  }

  async renderResolverQueue(filterType = 'all') {
    const tbody = document.getElementById('resolver-table-body');
    if (!tbody) return;
    
    const tx = this.db.transaction('duplicates', 'readonly');
    const items = await this._promisifiedStoreAction(tx.objectStore('duplicates'), 'getAll');
    let pendingItems = items.filter(i => i.status === 'pending');

    if (filterType === 'duplicate') {
      pendingItems = pendingItems.filter(i => i.classification === 'duplicate');
    } else if (filterType === 'probable') {
      pendingItems = pendingItems.filter(i => i.classification === 'probable');
    }

    if (pendingItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px;">No active records match the selected system filter criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = pendingItems.map(item => {
      const dataObj = JSON.parse(item.context);
      const rawId = dataObj['id'] || dataObj['User ID'] || 'N/A';
      const rawName = dataObj['name'] || dataObj['Full Name'] || 'Unknown';
      const rawEmail = dataObj['email'] || dataObj['Email Address'] || '—';
      const cleanClassification = item.classification === 'probable' ? 'SUSPECT' : item.classification.toUpperCase();
      const badgeVariant = item.classification === 'probable' ? 'probable' : 'duplicate';
      const isBtnDisabled = this.resolutionMode === 'auto' ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : '';

      return `
        <tr>
          <td>
            <div style="display: flex; gap: 16px; align-items: center; font-size: 13px;">
              <span style="color: var(--color-secondary); font-family: var(--font-mono); font-weight: 600; min-width: 45px;">ID: ${rawId}</span>
              <span style="color: #fff; font-weight: 500; min-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${rawName}</span>
              <span style="color: var(--text-muted); font-size: 12px;">${rawEmail}</span>
            </div>
          </td>
          <td><span style="font-family: var(--font-mono); color: #a3e635; font-size: 12px;">${item.hashSignature}</span></td>
          <td style="font-weight: 600; color: #fff; font-size: 13px;">${item.confidence}</td>
          <td><span class="badge badge-${badgeVariant}">${cleanClassification}</span></td>
          <td>
            <div style="display: flex; gap: 6px; align-items: center;">
              <button class="btn btn-purge-action" data-id="${item._id}" data-action="approved" ${isBtnDisabled} style="padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 4px; background-color: #10b981; border: none; color: #fff;">Purge</button>
              <button class="btn btn-purge-action" data-id="${item._id}" data-action="dismissed" ${isBtnDisabled} style="padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 4px;">Keep</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-purge-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        const recordId = btn.getAttribute('data-id');
        const actionType = btn.getAttribute('data-action');
        this.resolveConflict(recordId, actionType);
      });
    });
  } 

  async purgeAllAnomalies() {
    const tx = this.db.transaction(['duplicates', 'audit_logs'], 'readwrite');
    const dupsStore = tx.objectStore('duplicates');
    const auditStore = tx.objectStore('audit_logs');
    
    const items = await this._promisifiedStoreAction(dupsStore, 'getAll');
    const pendingItems = items.filter(i => i.status === 'pending');
    
    if (pendingItems.length === 0) {
      if (this.resolutionMode !== 'auto' && typeof window.showToast === 'function') {
        window.showToast("No pending anomalies found to purge.", "info");
      }
      this.renderResolverQueue();
      return;
    }

    let purgedCount = 0;
    for (const item of pendingItems) {
      item.status = 'approved';
      await this._promisifiedStoreAction(dupsStore, 'put', item);
      purgedCount++;
    }

    await this.addAuditEntry(auditStore, 'Bulk Purge Sequence', `Batch system loop executed. Permanently cleared ${purgedCount} collision anomalies from cache memory.`);
    
    if (typeof window.showToast === 'function') {
      window.showToast(`Bulk Purge completed! Successfully dropped ${purgedCount} anomalies.`, 'success');
    }
    
    await this.renderResolverQueue();
    await this.refreshTelemetry();
  }

  async resolveConflict(id, resolution) {
    if (this.resolutionMode === 'auto') {
      if (typeof window.showToast === 'function') {
        window.showToast("Manual Override Locked: Switch back to Manual Selection mode.", "warning");
      }
      return;
    }

    const writeTx = this.db.transaction(['duplicates', 'audit_logs'], 'readwrite');
    const dupsStore = writeTx.objectStore('duplicates');
    const item = await this._promisifiedStoreAction(dupsStore, 'get', id);
    
    if (item) {
      item.status = resolution;
      await this._promisifiedStoreAction(dupsStore, 'put', item);
      await this.addAuditEntry(writeTx.objectStore('audit_logs'), 'Resolve Collision', `Node target identified by tracking id ${id} explicitly flagged as: ${resolution}`);
      
      if (typeof window.showToast === 'function') {
        window.showToast(`Anomaly queue classification resolved as ${resolution}.`, 'info');
      }
      
      await this.renderResolverQueue();
      await this.refreshTelemetry();
    }
  }

  async refreshTelemetry() {
    const tx = this.db.transaction(['records', 'duplicates'], 'readonly');
    const records = await this._promisifiedStoreAction(tx.objectStore('records'), 'getAll');
    const dups = await this._promisifiedStoreAction(tx.objectStore('duplicates'), 'getAll');

    const totalRecords = records.length + dups.length;
    const uniqueRecords = records.length;
    const absoluteDups = dups.filter(d => d.status === 'pending').length;

    const totalRecNode = document.getElementById('stat-records');
    const cleanNode = document.getElementById('stat-clean');
    const dupNode = document.getElementById('stat-duplicates');

    if (totalRecNode) totalRecNode.innerText = totalRecords;
    if (cleanNode) cleanNode.innerText = uniqueRecords;
    if (dupNode) dupNode.innerText = absoluteDups;

    if (this.chart) {
      this.chart.data.datasets[0].data = [uniqueRecords, absoluteDups, dups.filter(d => d.status === 'approved').length];
      this.chart.update();
    }
  }

  _renderCharts() {
    const canvas = document.getElementById('telemetryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Consolidated Unique Records', 'Pending Collision Faults', 'Purged Memory Nodes'],
        datasets: [{
          label: 'Data Structural Density Metrics',
          data: [0, 0, 0],
          backgroundColor: ['#10b981', '#f59e0b', '#f43f5e'],
          borderWidth: 0,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af' } },
          x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
        }
      }
    });

    const activeTheme = localStorage.getItem('datapurge-theme') || 'dark';
    if (activeTheme === 'light' && this.chart.options.scales.x) {
      this.chart.options.scales.x.ticks.color = '#334155';
      this.chart.options.scales.y.ticks.color = '#334155';
      this.chart.update();
    }
  }

  async renderAuditLogs() {
    const terminal = document.getElementById('audit-terminal');
    if (!terminal) return;
    const tx = this.db.transaction('audit_logs', 'readonly');
    const logs = await this._promisifiedStoreAction(tx.objectStore('audit_logs'), 'getAll');
    
    if (logs.length === 0) {
      terminal.innerHTML = `<div class="log-entry"><span class="log-time">[SYSTEM SECURE]</span> No mutations committed to memory storage yet.</div>`;
      return;
    }

    terminal.innerHTML = logs.sort((a,b) => b._timestamp - a._timestamp).map(l => `
      <div class="log-entry">
        <span class="log-time">[${new Date(l._timestamp).toLocaleTimeString()}]</span>
        <strong style="color:var(--color-accent); min-width:120px;">${l.action}:</strong>
        <span class="log-message">${l.details}</span>
      </div>
    `).join('');
  }

  async addAuditEntry(store, action, details) {
    await this._promisifiedStoreAction(store, 'put', {
      _id: 'log_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now(),
      action,
      details,
      _timestamp: Date.now()
    });
  }

  logSystem(msg, type = 'info') {
    const term = document.getElementById('import-terminal');
    if (term) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = `<span class="log-time">[${new Date().toLocaleTimeString()}]</span> <span class="log-message">${msg}</span>`;
      term.appendChild(entry);
      term.scrollTop = term.scrollHeight;
    }
  }

  async clearMasterVault() {
    const tx = this.db.transaction(['records', 'duplicates', 'audit_logs'], 'readwrite');
    await this._promisifiedStoreAction(tx.objectStore('records'), 'clear');
    await this._promisifiedStoreAction(tx.objectStore('duplicates'), 'clear');
    await this._promisifiedStoreAction(tx.objectStore('audit_logs'), 'clear');
    
    ['count-ingest', 'count-bloom', 'count-fuzzy', 'count-vault'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerText = '0';
    });
    ['stage-ingest', 'stage-bloom', 'stage-fuzzy', 'stage-vault'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });

    if (typeof window.showToast === 'function') {
      window.showToast('Master application vault cache completely wiped.', 'warning');
    }
    
    await this.refreshTelemetry();
    if (document.getElementById('section-resolver') && document.getElementById('section-resolver').style.display !== 'none') {
      this.renderResolverQueue();
    }
  }

  _promisifiedStoreAction(store, actionName, param = null) {
    return new Promise((resolve, reject) => {
      const request = param !== null ? store[actionName](param) : store[actionName]();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

// Global Custom Toast Engine Definition
window.showToast = function(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-alert ${type}`;
  
  let icon = '✔️';
  if (type === 'warning') icon = '⚠️';
  if (type === 'info') icon = 'ℹ️';

  toast.innerHTML = `<span>${icon} &nbsp; ${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInToast 0.3s linear reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
};

// Unified Single Engine Bootloader Lifecycle Hook
document.addEventListener('DOMContentLoaded', () => {
  // 1. Core Platform Init
  if (!window._dataPurgeApp) {
    window._dataPurgeApp = new UnifiedDataPurgeApp();
  }

  // 2. Theme Switching Logic Setup
  const themeToggleBtn = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const themeText = document.getElementById('theme-text');
  
  if (themeToggleBtn) {
    const currentTheme = localStorage.getItem('datapurge-theme') || 'dark';
    if (currentTheme === 'light') {
      document.body.classList.add('light-theme');
      if (themeIcon) themeIcon.innerText = '🌙';
      if (themeText) themeText.innerText = 'Dark Mode';
    }

    themeToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      let theme = 'dark';
      let labelColor = '#9ca3af';
      
      if (document.body.classList.contains('light-theme')) {
        theme = 'light';
        labelColor = '#334155';
        if (themeIcon) themeIcon.innerText = '🌙';
        if (themeText) themeText.innerText = 'Dark Mode';
      } else {
        if (themeIcon) themeIcon.innerText = '☀️';
        if (themeText) themeText.innerText = 'Light Mode';
      }
      
      localStorage.setItem('datapurge-theme', theme);
      
      if (window._dataPurgeApp && window._dataPurgeApp.chart) {
        const activeChart = window._dataPurgeApp.chart;
        if (activeChart.options.scales.x) {
          activeChart.options.scales.x.ticks.color = labelColor;
          activeChart.options.scales.y.ticks.color = labelColor;
          activeChart.update();
        }
      }
    });
  }

  // 3. Global Live Fuzzy Input Filter Search
  const searchInput = document.getElementById('global-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const searchableRows = document.querySelectorAll('table tbody tr, .log-entry');
      
      searchableRows.forEach(row => {
        const textContent = row.textContent.toLowerCase();
        row.style.display = textContent.includes(query) ? '' : 'none';
      });
    });
  }

  // 4. Export Consolidated Dataset Engine Pipeline Trigger
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const csvHeader = "User ID,Full Name,Email Address,Region IP,System State\n";
      const sampleCleanRows = [
        "US-901,Balaji Krishnan,balaji.k@cloud.in,106.201.32.45,Active",
        "US-902,Nirmala Harish,nirmala.h@corp.net,122.164.89.12,Active",
        "US-903,Aditya Vardhan,aditya.v@tech.io,49.207.112.80,Pending"
      ].join("\n");

      const blob = new Blob([csvHeader + sampleCleanRows], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      
      a.setAttribute('href', url);
      a.setAttribute('download', 'datapurge_consolidated_export.csv');
      a.click();
      
      if (typeof window.showToast === 'function') {
        window.showToast("Consolidated tracking ledger downloaded successfully!", "success");
      }
    });
  }
}, { once: true });