// js/engine.js — DataPurge Deduplication Orchestrator

import { normalize, computeFieldSimilarity, sha256Hash } from './algorithms.js';
import { BloomFilter } from './bloom.js';

export class DeduplicationEngine {
  constructor() {
    this.bloomFilter = new BloomFilter(100000, 7);
    this.fieldWeights = {}; 
    this.thresholds = {
      confirmed: 0.90,   
      probable: 0.70,    
      unique: 0.70       
    };
    this.hashIndex = new Map();
  }

  setFieldWeights(weights) {
    this.fieldWeights = weights;
  }

  setThresholds(thresholds) {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  _generateFingerprint(record, fields) {
    // Sort keys to ensure consistent hashing
    const keys = Object.keys(record).filter(k => fields.includes(k) && !k.startsWith('_')).sort();
    return keys.map(k => normalize(record[k])).join('|');
  }

  async checkRecord(newRecord, existingRecords, schema) {
    const fields = Object.keys(schema);
    const fp = this._generateFingerprint(newRecord, fields);
    
    // Step 1: Bloom Filter check
    const mightExist = this.bloomFilter.test(fp);
    if (!mightExist) {
      return {
        classification: 'unique',
        confidence: 0,
        breakdown: {},
        matchedRecord: null,
        bloomResult: 'pass',
        isExactHash: false
      };
    }

    // Step 2: SHA-256 exact match check
    const hash = await sha256Hash(fp);
    if (this.hashIndex.has(hash)) {
      const matchId = this.hashIndex.get(hash);
      const matchedRecord = existingRecords.find(r => r._id === matchId);
      if (matchedRecord) {
        return {
          classification: 'duplicate',
          confidence: 100,
          breakdown: { exact: { similarity: 1 } },
          matchedRecord,
          bloomResult: 'flagged',
          isExactHash: true
        };
      }
    }

    // Step 3 & 4: Deep comparison against existing records
    let bestMatch = null;
    let highestConfidence = 0;
    let bestBreakdown = null;

    for (const existingRecord of existingRecords) {
      const breakdown = {};
      let totalWeight = 0;
      let weightedSimilarity = 0;

      for (const field of fields) {
        if (!existingRecord[field] && !newRecord[field]) continue;
        
        const type = schema[field] || 'text';
        const weight = this.fieldWeights[field] !== undefined ? this.fieldWeights[field] : 1;
        
        const simResult = computeFieldSimilarity(newRecord[field], existingRecord[field], type);
        
        breakdown[field] = simResult;
        weightedSimilarity += (simResult.similarity * weight);
        totalWeight += weight;
      }

      const confidence = totalWeight > 0 ? (weightedSimilarity / totalWeight) : 0;
      
      if (confidence > highestConfidence) {
        highestConfidence = confidence;
        bestMatch = existingRecord;
        bestBreakdown = breakdown;
      }
    }

    // Step 7: Classify based on thresholds
    let classification = 'unique';
    if (highestConfidence >= this.thresholds.confirmed) {
      classification = 'duplicate';
    } else if (highestConfidence >= this.thresholds.probable) {
      classification = 'probable';
    }

    return {
      classification,
      confidence: Math.round(highestConfidence * 100),
      breakdown: bestBreakdown || {},
      matchedRecord: bestMatch,
      bloomResult: 'flagged',
      isExactHash: false
    };
  }

  async processBatch(records, existingRecords, schema) {
    const results = [];
    const fields = Object.keys(schema);
    const accepted = [...existingRecords];
    
    this.bloomFilter.clear();
    this.hashIndex.clear();
    
    for (const rec of existingRecords) {
      const fp = this._generateFingerprint(rec, fields);
      this.bloomFilter.add(fp);
      const hash = await sha256Hash(fp);
      this.hashIndex.set(hash, rec._id);
    }
    
    for (const record of records) {
      const result = await this.checkRecord(record, accepted, schema);
      result.record = record;
      results.push(result);
      
      if (result.classification === 'unique') {
        accepted.push(record);
        const fp = this._generateFingerprint(record, fields);
        this.bloomFilter.add(fp);
        const hash = await sha256Hash(fp);
        this.hashIndex.set(hash, record._id || Date.now().toString());
      }
    }
    
    return results;
  }

  getStats() {
    return {
      bloomFillRatio: this.bloomFilter.fillRatio,
      hashIndexSize: this.hashIndex.size,
      thresholds: { ...this.thresholds }
    };
  }
}
