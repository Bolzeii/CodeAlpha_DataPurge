// js/algorithms.js — DataPurge Similarity Algorithms

export function normalize(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s@.\-]/g, '')
    .replace(/\s+/g, ' ');
}

export function levenshteinSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;

  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i += 1) { matrix[0][i] = i; }
  for (let j = 0; j <= b.length; j += 1) { matrix[j][0] = j; }

  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // insertion
        matrix[j - 1][i] + 1, // deletion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  const distance = matrix[b.length][a.length];
  const maxLength = Math.max(a.length, b.length);
  return 1 - (distance / maxLength);
}

export function jaroWinklerSimilarity(s1, s2) {
  if (!s1 && !s2) return 1;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  let m = 0;
  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      m++;
      break;
    }
  }

  if (m === 0) return 0;

  let k = 0;
  let numTransposes = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) numTransposes++;
    k++;
  }

  const jaro = ((m / s1.length) + (m / s2.length) + ((m - numTransposes / 2) / m)) / 3;
  
  // Winkler modification
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + (prefix * 0.1 * (1 - jaro));
}

export function soundexCode(str) {
  if (!str) return '';
  const s = String(str).toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return '';

  const codes = {
    B: 1, F: 1, P: 1, V: 1,
    C: 2, G: 2, J: 2, K: 2, Q: 2, S: 2, X: 2, Z: 2,
    D: 3, T: 3,
    L: 4,
    M: 5, N: 5,
    R: 6
  };

  let result = s[0];
  let prevCode = codes[s[0]];

  for (let i = 1; i < s.length && result.length < 4; i++) {
    const code = codes[s[i]];
    if (code !== undefined) {
      if (code !== prevCode) {
        result += code;
      }
      prevCode = code;
    } else {
      prevCode = null;
    }
  }
  return result.padEnd(4, '0');
}

export function soundexMatch(a, b) {
  if (!a || !b) return { match: false, codeA: '', codeB: '', similarity: 0 };
  const codeA = soundexCode(a);
  const codeB = soundexCode(b);
  const match = codeA === codeB && codeA !== '';
  return { match, codeA, codeB, similarity: match ? 1 : 0 };
}

export function ngramSimilarity(a, b, n = 2) {
  if (!a || !b) return 0;
  if (a.length < n || b.length < n) return levenshteinSimilarity(a, b);

  const getNGrams = (str, n) => {
    const ngrams = [];
    for (let i = 0; i <= str.length - n; i++) {
      ngrams.push(str.substring(i, i + n));
    }
    return ngrams;
  };

  const ngramsA = getNGrams(a, n);
  const ngramsB = getNGrams(b, n);
  
  let intersection = 0;
  const mapA = {};
  for (const ng of ngramsA) mapA[ng] = (mapA[ng] || 0) + 1;

  for (const ng of ngramsB) {
    if (mapA[ng] > 0) {
      intersection++;
      mapA[ng]--;
    }
  }

  return (2 * intersection) / (ngramsA.length + ngramsB.length);
}

export async function sha256Hash(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function computeFieldSimilarity(val1, val2, fieldType = 'text') {
  const norm1 = normalize(val1);
  const norm2 = normalize(val2);
  
  if (!norm1 && !norm2) return { similarity: 1, algorithms: { exact: 1 } };
  if (!norm1 || !norm2) return { similarity: 0, algorithms: { exact: 0 } };
  if (norm1 === norm2) return { similarity: 1, algorithms: { exact: 1 } };

  const levenshtein = levenshteinSimilarity(norm1, norm2);
  const jaro = jaroWinklerSimilarity(norm1, norm2);
  const ngram = ngramSimilarity(norm1, norm2);
  const soundex = soundexMatch(norm1, norm2).similarity;

  let similarity = 0;
  
  // Weights based on field type
  switch (fieldType) {
    case 'name':
      // Names benefit from phonetic and Jaro-Winkler
      similarity = (jaro * 0.4) + (soundex * 0.3) + (levenshtein * 0.3);
      break;
    case 'email':
      // Emails need exactness, typos are caught well by levenshtein
      similarity = (levenshtein * 0.7) + (jaro * 0.3);
      break;
    case 'phone':
      similarity = levenshtein;
      break;
    default: // text
      similarity = (ngram * 0.4) + (levenshtein * 0.4) + (jaro * 0.2);
      break;
  }

  return {
    similarity,
    algorithms: {
      levenshtein,
      jaroWinkler: jaro,
      soundex,
      ngram
    }
  };
}
