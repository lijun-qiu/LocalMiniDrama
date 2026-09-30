'use strict';
/**
 * Repair 遗憾 ep1: re-prepare step1 (分场 split + mentions), confirm, regenerate video_units with asset bindings.
 */
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'data/drama_generator.db'));
const log = { info: (...a) => console.log('[info]', ...a), warn: (...a) => console.warn('[warn]', ...a), error: (...a) => console.error('[err]', ...a) };

const scriptReview = require('./src/services/workflow/scriptReviewService');
const videoUnits = require('./src/services/workflow/videoUnitsService');

const episodeId = 37;
console.log('1) prepareStep1…');
const prepared = scriptReview.prepareStep1(db, episodeId);
const units = prepared?.content?.units || [];
console.log('  units:', units.length);
if (units[0]) console.log('  sample0:', String(units[0].text || '').slice(0, 120));
if (units[1]) console.log('  sample1:', String(units[1].text || '').slice(0, 120));

console.log('2) confirmStep1…');
scriptReview.confirmStep1(db, episodeId);

console.log('3) generateReferenceScript…');
const out = videoUnits.generateReferenceScript(db, log, episodeId);
console.log('  storyboards:', out.storyboard_count);

const sbs = db
  .prepare(
    `SELECT id, storyboard_number, title, scene_id, characters, substr(universal_segment_text,1,100) t
     FROM storyboards WHERE episode_id=? AND deleted_at IS NULL ORDER BY storyboard_number`
  )
  .all(episodeId);
for (const s of sbs.slice(0, 4)) {
  console.log('  sb', s.storyboard_number, 'scene', s.scene_id, 'chars', s.characters, 'text', s.t);
}
db.close();
console.log('done');
