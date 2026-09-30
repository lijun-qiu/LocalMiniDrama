'use strict';

/**
 * Lightweight artifact currency claims (ArcReel .arcreel_artifacts.json subset).
 * Stored at {projectDir}/.lmd_artifacts.json
 */

const fs = require('fs');
const path = require('path');
const { basisDigest, digestRaw } = require('./canonicalDigest');

const MANIFEST_NAME = '.lmd_artifacts.json';

function encodeKey(kind, ...components) {
  const payload = JSON.stringify([kind, ...components.map(String)]);
  return `artifact-key-v1:${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

const ArtifactKey = {
  episodeStep1: (ep) => encodeKey('episode_step1', ep),
  episodeScript: (ep) => encodeKey('episode_script', ep),
  assetSheet: (type, id) => encodeKey('asset_sheet', type, id),
  storyboardImage: (ep, sbId) => encodeKey('storyboard_image', ep, sbId),
  videoClip: (ep, unitId) => encodeKey('video_clip', ep, unitId),
};

function emptyManifest() {
  return { schema_version: 1, hash_algorithm: 'sha256-v1', entries: {} };
}

function loadManifest(projectAbsDir) {
  const file = path.join(projectAbsDir, MANIFEST_NAME);
  if (!fs.existsSync(file)) return emptyManifest();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return emptyManifest();
    return {
      schema_version: 1,
      hash_algorithm: 'sha256-v1',
      entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {},
    };
  } catch {
    return emptyManifest();
  }
}

function saveManifest(projectAbsDir, manifest) {
  fs.mkdirSync(projectAbsDir, { recursive: true });
  const file = path.join(projectAbsDir, MANIFEST_NAME);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Register or refresh a claim after a successful write.
 * @param {string} projectAbsDir
 * @param {string} key
 * @param {string} artifactRelPath posix-ish relative path or db: synthetic path
 * @param {{ kind?: string, kind_version?: number, inputs: object }} basisInputs
 */
function registerCurrent(projectAbsDir, key, artifactRelPath, basisInputs) {
  const manifest = loadManifest(projectAbsDir);
  manifest.entries[key] = {
    artifact_path: String(artifactRelPath).replace(/\\/g, '/'),
    basis_digest: basisDigest(basisInputs),
  };
  saveManifest(projectAbsDir, manifest);
  return manifest.entries[key];
}

/**
 * @returns {'current'|'stale'|'missing'|'blocked'}
 */
function compare(projectAbsDir, key, artifactRelPath, expectedBasisInputs) {
  const rel = String(artifactRelPath || '').replace(/\\/g, '/');
  if (!rel) return 'missing';

  // Synthetic db: paths — existence checked by caller; currency by claim only
  const isDb = rel.startsWith('db:');
  if (!isDb) {
    const abs = path.isAbsolute(rel) ? rel : path.join(projectAbsDir, rel);
    try {
      if (!fs.existsSync(abs)) return 'missing';
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) return 'blocked';
    } catch {
      return 'blocked';
    }
  }

  const manifest = loadManifest(projectAbsDir);
  const entry = manifest.entries[key];
  if (!entry || entry.artifact_path !== rel) return 'missing';

  const expected = basisDigest(expectedBasisInputs);
  if (entry.basis_digest === expected) return 'current';
  return 'stale';
}

function contentDigestOfFile(absPath) {
  if (!fs.existsSync(absPath)) return null;
  return digestRaw(fs.readFileSync(absPath));
}

module.exports = {
  MANIFEST_NAME,
  ArtifactKey,
  loadManifest,
  saveManifest,
  registerCurrent,
  compare,
  contentDigestOfFile,
  basisDigest,
};
