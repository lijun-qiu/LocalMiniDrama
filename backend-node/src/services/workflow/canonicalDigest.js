'use strict';

const crypto = require('crypto');

/**
 * Stable SHA-256 hex of JSON with recursively sorted object keys.
 * Mirrors ArcReel canonical_json_digest for OCC / currency basis.
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalJsonDigest(value) {
  const canonical = JSON.stringify(sortKeysDeep(value));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function digestRaw(textOrBuffer) {
  return crypto.createHash('sha256').update(textOrBuffer || '').digest('hex');
}

/** Prefixed digest used in artifact claims (sha256-v1:<hex>). */
function basisDigest(inputs) {
  const payload = {
    kind: inputs.kind || 'structured-content',
    kind_version: inputs.kind_version || 1,
    inputs: inputs.inputs || {},
  };
  return `sha256-v1:${canonicalJsonDigest(payload)}`;
}

module.exports = {
  sortKeysDeep,
  canonicalJsonDigest,
  digestRaw,
  basisDigest,
};
