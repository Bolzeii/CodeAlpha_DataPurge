// js/importer.js — Data Import & Schema Detection

export class DataImporter {
  constructor(db, engine, audit, onComplete) {
    this.db = db;
    this.engine = engine;
    this.audit = audit;
    this.onComplete = onComplete;
    this.container = null;
    this.parsedData = null; 
  }

  init(container) {
    this.container = container;
    this._renderImportUI();
  }

  _renderImportUI() {
    this.container.innerHTML = `
      <div class="card mb-lg">
        <h2 class="card-title mb-md">Import Bulk Data</h2>
        <p class="text-muted mb-lg">Upload a CSV or JSON file containing records to deduplicate.</p>
        
        <div class="dropzone" id="import-dropzone">
          <svg class="dropzone-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div class="dropzone-text">Drag and drop your file here, or <span>browse</span></div>
          <input type="file" id="import-file-input" accept=".csv,.json" style="display:none">
        </div>
      </div>

      <div class="card mb-lg" id="import-schema-section" style="display:none">
        <div class="card-header">
          <h2 class="card-title">Schema Configuration</h2>
          <button class="btn btn-primary" id="btn-process-import">Run Deduplication Engine</button>
        </div>
        <p class="text-muted mb-md">We've auto-detected your column types. Adjust weights to tell the engine which fields are most important for matching.</p>
        <div id="schema-config-grid" class="card-grid mb-lg"></div>
        
        <h3 class="card-title mb-md" style="font-size: 14px;">Data Preview</h3>
        <div class="data-table-wrapper">
          <table class="data-table" id="preview-table">
            <thead><tr id="preview-thead"></tr></thead>
            <tbody id="preview-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    const dropzone = document.getElementById('import-dropzone');
    const fileInput = document.getElementById('import-file-input');

    dropzone.addEventListener('click', () => fileInput.click());
    
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        this._processFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        this._processFile(e.target.files[0]);
      }
    });

    document.getElementById('btn-process-import').addEventListener('click', () => this.processImport());
  }

  parseCSV(text) {
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const rows = lines.slice(1).map(line => {
      const row = [];
      let current = '';
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) { row.push(current.trim()); current = ''; }
        else current += char;
      }
      row.push(current.trim());
      return row;
    }).filter(row => row.some(cell => cell.length > 0));
    return { headers, rows };
  }

  parseJSON(text) {
    const data = JSON.parse(text);
    const array = Array.isArray(data) ? data : [data];
    const headers = Object.keys(array[0] || {});
    const rows = array.map(obj => headers.map(h => String(obj[h] || '')));
    return { headers, rows };
  }

  detectSchema(headers) {
    const schema = {};
    const defaultWeights = {};
    
    headers.forEach(h => {
      const lower = h.toLowerCase();
      let type = 'text';
      let weight = 1;
      
      if (lower.includes('email') || lower.includes('mail')) { type = 'email'; weight = 2.0; }
      else if (lower.includes('phone') || lower.includes('tel') || lower.includes('mobile')) { type = 'phone'; weight = 1.5; }
      else if (lower.includes('name') || lower.includes('first') || lower.includes('last')) { type = 'name'; weight = 1.8; }
      else if (lower.includes('id') || lower.includes('code') || lower.includes('number')) { type = 'id'; weight = 2.5; }
      
      schema[h] = type;
      defaultWeights[h] = weight;
    });
    
    return { schema, defaultWeights };
  }

  async _processFile(file) {
    try {
      const text = await file.text();
      let parsed;
      if (file.name.endsWith('.json')) parsed = this.parseJSON(text);
      else parsed = this.parseCSV(text);
      
      const { schema, defaultWeights } = this.detectSchema(parsed.headers);
      this.parsedData = { ...parsed, schema, weights: defaultWeights };
      
      this._showPreview();
      window.showToast(`Successfully parsed ${parsed.rows.length} records`, 'success');
    } catch (err) {
      window.showToast('Error parsing file: ' + err.message, 'error');
    }
  }

  _showPreview() {
    const section = document.getElementById('import-schema-section');
    section.style.display = 'block';
    
    // Render Schema Config
    const grid = document.getElementById('schema-config-grid');
    grid.innerHTML = '';
    
    this.parsedData.headers.forEach(h => {
      const type = this.parsedData.schema[h];
      const weightVal = this.parsedData.weights[h] * 50; // map 0-2 range to 0-100 slider
      
      const el = document.createElement('div');
      el.className = 'comparison-side';
      el.innerHTML = `
        <div class="flex justify-between align-center mb-sm">
          <strong>${h}</strong>
          <span class="tag tag-probable">${type}</span>
        </div>
        <label class="form-label">Importance Weight</label>
        <input type="range" min="0" max="100" value="${weightVal}" class="form-input weight-slider" data-field="${h}">
      `;
      grid.appendChild(el);
    });

    // Render Preview Table
    const thead = document.getElementById('preview-thead');
    thead.innerHTML = this.parsedData.headers.map(h => `<th>${h}</th>`).join('');
    
    const tbody = document.getElementById('preview-tbody');
    const sampleRows = this.parsedData.rows.slice(0, 5);
    tbody.innerHTML = sampleRows.map(row => 
      `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
    ).join('');
  }

  async processImport() {
    // 1. Update weights from sliders
    const sliders = document.querySelectorAll('.weight-slider');
    const engineWeights = {};
    sliders.forEach(sl => {
      engineWeights[sl.dataset.field] = parseInt(sl.value) / 50; // map 0-100 back to 0-2 multiplier
    });
    this.engine.setFieldWeights(engineWeights);

    // 2. Convert to object format
    const records = this.parsedData.rows.map((row, i) => {
      const obj = { _id: 'import_' + Date.now() + '_' + i };
      this.parsedData.headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });

    // 3. Process Batch
    document.getElementById('btn-process-import').textContent = 'Processing...';
    document.getElementById('btn-process-import').disabled = true;
    
    const existingRecords = await this.db.getAllRecords();
    const results = await this.engine.processBatch(records, existingRecords, this.parsedData.schema);
    
    // 4. Save to DB
    for (const res of results) {
      if (res.classification === 'unique') {
        const hash = res.isExactHash ? 'hash' : 'fp_' + Date.now() + Math.random(); 
        await this.db.addRecord(res.record, hash);
      } else {
        await this.db.addDuplicate({
          newRecord: res.record,
          matchedRecordId: res.matchedRecord._id,
          matchedRecord: res.matchedRecord,
          confidence: res.confidence,
          classification: res.classification,
          breakdown: res.breakdown
        });
      }
    }

    await this.audit.log('import', `Processed batch import of ${records.length} records.`);
    
    document.getElementById('import-schema-section').style.display = 'none';
    document.getElementById('btn-process-import').textContent = 'Run Deduplication Engine';
    document.getElementById('btn-process-import').disabled = false;
    
    // 5. Notify App Controller to switch to pipeline view
    if (this.onComplete) {
      document.getElementById('nav-pipeline').click();
      this.onComplete(results);
    }
  }
}
