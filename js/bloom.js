// js/bloom.js — Bloom Filter for O(1) Duplicate Pre-screening

export class BloomFilter {
  constructor(size = 50000, hashCount = 7) {
    this.size = size;
    this.hashCount = hashCount;
    this.bitArray = new Uint8Array(this.size);
  }

  // FNV-1a hash variant with seed
  _hash(str, seed) {
    let h1 = 0x811c9dc5 ^ seed;
    for (let i = 0; i < str.length; i++) {
      h1 ^= str.charCodeAt(i);
      h1 += (h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24);
    }
    return Math.abs(h1) % this.size;
  }

  add(item) {
    const strItem = String(item);
    for (let i = 0; i < this.hashCount; i++) {
      const position = this._hash(strItem, i);
      this.bitArray[position] = 1;
    }
  }

  test(item) {
    const strItem = String(item);
    for (let i = 0; i < this.hashCount; i++) {
      const position = this._hash(strItem, i);
      if (this.bitArray[position] === 0) {
        return false; // Definitely not in the set
      }
    }
    return true; // Possibly in the set
  }

  clear() {
    this.bitArray.fill(0);
  }

  get fillRatio() {
    let setBits = 0;
    for (let i = 0; i < this.size; i++) {
      if (this.bitArray[i] === 1) setBits++;
    }
    return setBits / this.size;
  }
}
