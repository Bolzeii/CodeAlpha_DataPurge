// js/db.js — DataPurge Cloud Database Simulation (IndexedDB)

export class DataPurgeDB {
  constructor() {
    this.dbName = 'DataPurgeDB';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', { keyPath: '_id' });
          store.createIndex('hash', '_hash', { unique: true });
          store.createIndex('timestamp', '_timestamp', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('duplicates')) {
          const store = db.createObjectStore('duplicates', { keyPath: '_id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('classification', 'classification', { unique: false });
          store.createIndex('timestamp', '_timestamp', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('audit_log')) {
          const store = db.createObjectStore('audit_log', { keyPath: '_id' });
          store.createIndex('action', 'action', { unique: false });
          store.createIndex('timestamp', '_timestamp', { unique: false });
        }
      };
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
      
      request.onerror = (event) => reject(event.target.error);
    });
  }

  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // === RECORDS STORE ===
  
  async addRecord(record, hash) {
    const tx = this.db.transaction('records', 'readwrite');
    const store = tx.objectStore('records');
    record._id = record._id || this._generateId();
    record._hash = hash;
    record._timestamp = Date.now();
    return this._promisifyRequest(store.put(record));
  }
  
  async getAllRecords() {
    const tx = this.db.transaction('records', 'readonly');
    return this._promisifyRequest(tx.objectStore('records').getAll());
  }
  
  async getRecord(id) {
    const tx = this.db.transaction('records', 'readonly');
    return this._promisifyRequest(tx.objectStore('records').get(id));
  }
  
  async hashExists(hash) {
    const tx = this.db.transaction('records', 'readonly');
    const index = tx.objectStore('records').index('hash');
    const request = index.getKey(hash);
    const result = await this._promisifyRequest(request);
    return result !== undefined;
  }
  
  async deleteRecord(id) {
    const tx = this.db.transaction('records', 'readwrite');
    return this._promisifyRequest(tx.objectStore('records').delete(id));
  }

  // === DUPLICATES STORE ===
  
  async addDuplicate(duplicateInfo) {
    const tx = this.db.transaction('duplicates', 'readwrite');
    const store = tx.objectStore('duplicates');
    duplicateInfo._id = duplicateInfo._id || this._generateId();
    duplicateInfo._timestamp = Date.now();
    duplicateInfo.status = 'pending';
    return this._promisifyRequest(store.put(duplicateInfo));
  }
  
  async getAllDuplicates(statusFilter = null) {
    const tx = this.db.transaction('duplicates', 'readonly');
    const store = tx.objectStore('duplicates');
    let duplicates = await this._promisifyRequest(store.getAll());
    
    if (statusFilter) {
      duplicates = duplicates.filter(d => d.status === statusFilter);
    }
    // Sort newest first
    return duplicates.sort((a, b) => b._timestamp - a._timestamp);
  }
  
  async resolveDuplicate(id, resolution) {
    const tx = this.db.transaction('duplicates', 'readwrite');
    const store = tx.objectStore('duplicates');
    const dup = await this._promisifyRequest(store.get(id));
    if (dup) {
      dup.status = 'resolved';
      dup.resolution = resolution;
      dup._resolvedAt = Date.now();
      return this._promisifyRequest(store.put(dup));
    }
  }
  
  async getPendingDuplicateCount() {
    const duplicates = await this.getAllDuplicates('pending');
    return duplicates.length;
  }

  // === AUDIT LOG ===
  
  async addAuditLog(action, details, recordId = null) {
    const tx = this.db.transaction('audit_log', 'readwrite');
    const store = tx.objectStore('audit_log');
    const entry = {
      _id: this._generateId(),
      _timestamp: Date.now(),
      action,
      details,
      recordId
    };
    return this._promisifyRequest(store.add(entry));
  }
  
  async getAuditLogs(actionFilter = null) {
    const tx = this.db.transaction('audit_log', 'readonly');
    const store = tx.objectStore('audit_log');
    let logs = await this._promisifyRequest(store.getAll());
    if (actionFilter && actionFilter !== 'all') {
      logs = logs.filter(l => l.action === actionFilter);
    }
    return logs.sort((a, b) => b._timestamp - a._timestamp);
  }

  // === STATS ===
  
  async getStats() {
    const tx = this.db.transaction(['records', 'duplicates', 'audit_log'], 'readonly');
    
    const countRequest = (storeName) => this._promisifyRequest(tx.objectStore(storeName).count());
    
    const [totalRecords, totalDuplicates, auditLogCount] = await Promise.all([
      countRequest('records'),
      countRequest('duplicates'),
      countRequest('audit_log')
    ]);

    const pendingDuplicates = await this.getPendingDuplicateCount();
    const resolvedDuplicates = totalDuplicates - pendingDuplicates;

    return {
      totalRecords,
      totalDuplicates,
      pendingDuplicates,
      resolvedDuplicates,
      auditLogCount
    };
  }
  
  async clearAll() {
    const stores = ['records', 'duplicates', 'audit_log'];
    const tx = this.db.transaction(stores, 'readwrite');
    
    const promises = stores.map(store => {
      return this._promisifyRequest(tx.objectStore(store).clear());
    });
    
    await Promise.all(promises);
    await this.addAuditLog('clear', 'Database completely cleared by user');
  }
}
