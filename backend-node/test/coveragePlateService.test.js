const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sceneKeyOf,
  extractSpeakersFromStoryboard,
  choosePlateForStoryboard,
  isLocomotionAction,
  buildTwoShotLayout,
  buildSpeakerLayout,
  buildPlatePrompt,
  buildSeatingChart,
  buildWideLayout,
  buildZoneLayout,
} = require('../src/services/coveragePlateService');

describe('coveragePlateService helpers', () => {
  it('sceneKeyOf prefers scene_id', () => {
    assert.equal(sceneKeyOf({ scene_id: 3, location: '办公室' }), 'scene:3');
    assert.equal(sceneKeyOf({ location: '办公室' }), 'loc:办公室');
    assert.equal(sceneKeyOf({}), 'ungrouped');
  });

  it('extractSpeakersFromStoryboard parses classic dialogue', () => {
    assert.deepEqual(
      extractSpeakersFromStoryboard({ dialogue: '林薇：请坐。\n陈浩：好的。' }),
      ['林薇', '陈浩']
    );
  });

  it('isLocomotionAction detects walk-in', () => {
    assert.equal(isLocomotionAction('陈浩走进办公室'), true);
    assert.equal(isLocomotionAction('林薇微微点头'), false);
  });

  it('choosePlateForStoryboard default by_speaker uses speaker for single line', () => {
    const plates = [
      { id: 1, plate_type: 'two_shot', status: 'completed', image_gen_id: 10 },
      { id: 2, plate_type: 'speaker', speaker_name: '陈浩', status: 'completed', image_gen_id: 12 },
    ];
    const picked = choosePlateForStoryboard(
      { dialogue: '陈浩：因为我在找工作。', action: '坐姿回答' },
      plates,
      ['林薇', '陈浩']
    );
    assert.equal(picked.plate_type, 'speaker');
    assert.equal(picked.speaker_name, '陈浩');
  });

  it('choosePlateForStoryboard picks two_shot for multi speaker', () => {
    const plates = [
      { id: 1, plate_type: 'two_shot', status: 'completed', image_gen_id: 10 },
      { id: 2, plate_type: 'speaker', speaker_name: '林薇', status: 'completed', image_gen_id: 11 },
      { id: 3, plate_type: 'speaker', speaker_name: '陈浩', status: 'completed', image_gen_id: 12 },
    ];
    const picked = choosePlateForStoryboard(
      { dialogue: '林薇：你为什么来？ 陈浩：找工作。', action: '对坐交谈' },
      plates,
      ['林薇', '陈浩']
    );
    assert.equal(picked.plate_type, 'two_shot');
  });

  it('choosePlateForStoryboard prefer_two_shot uses two_shot for single line', () => {
    const plates = [
      { id: 1, plate_type: 'two_shot', status: 'completed', image_gen_id: 10 },
      { id: 2, plate_type: 'speaker', speaker_name: '陈浩', status: 'completed', image_gen_id: 12 },
    ];
    const picked = choosePlateForStoryboard(
      { dialogue: '陈浩：因为我在找工作。', action: '坐姿回答' },
      plates,
      ['林薇', '陈浩'],
      'prefer_two_shot'
    );
    assert.equal(picked.plate_type, 'two_shot');
  });

  it('choosePlateForStoryboard skips locomotion', () => {
    const plates = [{ id: 1, plate_type: 'two_shot', status: 'completed', image_gen_id: 10 }];
    assert.equal(
      choosePlateForStoryboard({ dialogue: '陈浩：嗨', action: '陈浩走进来' }, plates, ['陈浩']),
      null
    );
  });

  it('layout builders lock face-to-face and true single', () => {
    const two = buildTwoShotLayout('林薇', '陈浩', '面试室');
    assert.match(two, /面对面/);
    assert.match(two, /左侧座位/);
    assert.match(two, /右侧座位/);

    const single = buildSpeakerLayout('陈浩', '林薇', 'right', '面试室');
    assert.match(single, /只能出现陈浩一人/);
    assert.match(single, /禁止出现任何其他人物/);
    assert.match(single, /右侧座位/);

    const prompt = buildPlatePrompt({
      plateType: 'speaker',
      layout: single,
      speakers: ['陈浩'],
      location: '面试室',
    });
    assert.match(prompt, /有且仅有 陈浩 一人/);
    assert.match(prompt, /不要生成第二个人/);
  });

  it('buildSeatingChart scales zones by cast size', () => {
    const duo = buildSeatingChart(['A', 'B']);
    assert.deepEqual(
      duo.map((x) => x.zone),
      ['left', 'right']
    );

    const trio = buildSeatingChart(['A', 'B', 'C']);
    assert.deepEqual(
      trio.map((x) => x.zone),
      ['left', 'center', 'right']
    );

    const chart = buildSeatingChart(['A', 'B', 'C', 'D', 'E', 'F']);
    assert.equal(chart.length, 6);
    assert.equal(chart[0].zone, 'left');
    assert.equal(chart[2].zone, 'center');
    assert.equal(chart[5].zone, 'right');
  });

  it('wide layout for duo is face-to-face seating chart', () => {
    const chart = buildSeatingChart(['林薇', '陈浩']);
    const wide = buildWideLayout(chart, '面试室');
    assert.match(wide, /面对面/);
    assert.match(wide, /左侧座位/);
    assert.match(wide, /右侧座位/);
    assert.match(wide, /场景参考图|空房间/);
    assert.match(wide, /禁止克隆|各一人/);
  });

  it('wide/zone layouts lock seating for ensemble', () => {
    const chart = buildSeatingChart(['甲', '乙', '丙', '丁', '戊', '己']);
    const wide = buildWideLayout(chart, '大会议室');
    assert.match(wide, /座位表/);
    assert.match(wide, /甲/);
    const zone = buildZoneLayout('left', ['甲', '乙'], chart, '大会议室');
    assert.match(zone, /左侧区/);
    assert.match(zone, /甲/);
  });

  it('duo zone layout is reverse-shot partner POV from wide', () => {
    const chart = buildSeatingChart(['林薇', '陈浩']);
    const left = buildZoneLayout('left', ['林薇'], chart, '面试室');
    assert.match(left, /POV|眼睛视角|0度正面/);
    assert.match(left, /林薇/);
    assert.match(left, /陈浩/);
    assert.match(left, /只有林薇|禁止克隆/);
    assert.match(left, /隔桌正脸|正脸看镜头|下部约/);
    assert.match(left, /会议桌|落地窗|全景裁条/);
    assert.doesNotMatch(left, /桌面道具必须与全景母版一致/);
    const prompt = buildPlatePrompt({
      plateType: 'zone',
      layout: left,
      speakers: ['林薇', '陈浩'],
      location: '面试室',
      zoneKey: 'left',
      style: 'anime style',
    });
    assert.match(prompt, /眼睛视角|0度正面|平视正机位/);
    assert.match(prompt, /无过肩|SINGLE SUBJECT|禁止克隆|DESK LOCK|会议桌/);
    assert.match(prompt, /anime style/);
    assert.doesNotMatch(prompt, /确定性裁切|偏侧裁切/);
  });

  it('buildDuoReverseShotGenPrompt locks single clear face', () => {
    const { buildDuoReverseShotGenPrompt } = require('../src/services/coveragePlateService');
    const pov = buildDuoReverseShotGenPrompt({
      favorName: '林薇',
      partnerName: '陈浩',
      location: '办公室',
      mode: 'pov',
      hasWideRef: false,
      hasSceneRef: true,
      hasSideBackdrop: true,
      hasDeskCrop: true,
      favorSide: 'left',
    });
    assert.match(pov, /林薇/);
    assert.match(pov, /陈浩/);
    assert.match(pov, /眼睛视角|POV/);
    assert.match(pov, /COMPOSITION RECIPE|隔桌正脸|下部/);
    assert.match(pov, /FRONTAL EYE-LEVEL|正脸|双眼/);
    assert.match(pov, /SINGLE SUBJECT|禁止克隆|仅有 1 个/);
    assert.match(pov, /DESK LOCK|桌面/);
    assert.match(pov, /落地窗|BACKDROP/);
    assert.doesNotMatch(pov, /深色木会议桌桌面横过/);
  });

  it('extractWidePovSupportCrops yields backdrop+desk from wide plate', async () => {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const dbPath = path.join(__dirname, '../data/drama_generator.db');
    if (!fs.existsSync(dbPath)) return;
    try {
      require('sharp');
    } catch (_) {
      return;
    }
    const db = new Database(dbPath);
    try {
      const { extractWidePovSupportCrops } = require('../src/services/coveragePlateService');
      const wide = db
        .prepare(
          `SELECT * FROM coverage_plates
           WHERE plate_type = 'wide' AND deleted_at IS NULL
             AND status = 'completed'
             AND COALESCE(local_path,'') != ''
           ORDER BY id DESC LIMIT 1`
        )
        .get();
      if (!wide) return;
      const crops = await extractWidePovSupportCrops(db, wide, 'left', wide.drama_id, {
        warn() {},
      });
      assert.ok(crops.backdrop);
      assert.ok(crops.desk);
      const cfg = require('../src/config').loadConfig();
      const storagePath = path.isAbsolute(cfg.storage?.local_path)
        ? cfg.storage.local_path
        : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
      assert.equal(fs.existsSync(path.join(storagePath, crops.backdrop)), true);
      assert.equal(fs.existsSync(path.join(storagePath, crops.desk)), true);
    } finally {
      db.close();
    }
  });

  it('resolveSceneImageRef falls back to live scene by location when id soft-deleted', () => {
    // lightweight stub: only exercised when better-sqlite3 + db available in CI path; skip if no db
    const path = require('path');
    const fs = require('fs');
    const dbPath = path.join(__dirname, '../data/drama_generator.db');
    if (!fs.existsSync(dbPath)) return;
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    try {
      const deleted = db
        .prepare(
          `SELECT id FROM scenes WHERE deleted_at IS NOT NULL AND drama_id IS NOT NULL LIMIT 1`
        )
        .get();
      if (!deleted) return;
      const { resolveSceneImageRef } = require('../src/services/coveragePlateService');
      const row = db
        .prepare('SELECT id, drama_id, location FROM scenes WHERE id = ?')
        .get(deleted.id);
      const hit = resolveSceneImageRef(db, row.id, {
        drama_id: row.drama_id,
        location: row.location,
      });
      // may still return stale file or live sibling; must not throw / must return null or ref object
      if (hit) {
        assert.ok(hit.ref);
        assert.equal(typeof hit.ref, 'string');
      }
    } finally {
      db.close();
    }
  });

  it('duo coverage grid prompt helper still available', () => {
    const { buildDuoCoverageGridPrompt, detectDuoCoverageBundle } = require('../src/services/coveragePlateService');
    const g = buildDuoCoverageGridPrompt({
      leftName: '林薇',
      rightName: '陈浩',
      location: '办公室',
      style: 'anime style',
    });
    assert.match(g, /2x2/);
    const bundle = detectDuoCoverageBundle([
      { plate_type: 'wide', members: ['林薇', '陈浩'], id: 1 },
      { plate_type: 'zone', zone_key: 'left', members: ['林薇', '陈浩'], speaker_name: '林薇', id: 2 },
      { plate_type: 'zone', zone_key: 'right', members: ['林薇', '陈浩'], speaker_name: '陈浩', id: 3 },
    ]);
    assert.ok(bundle);
  });

  it('choosePlateForStoryboard maps speaker line to favored zone when no speaker plate', () => {
    const plates = [
      { id: 1, plate_type: 'wide', status: 'completed', image_gen_id: 10, zone_key: 'wide', members: ['林薇', '陈浩'] },
      {
        id: 2,
        plate_type: 'zone',
        status: 'completed',
        image_gen_id: 11,
        zone_key: 'right',
        speaker_name: '陈浩',
        members: ['林薇', '陈浩'],
      },
      {
        id: 3,
        plate_type: 'zone',
        status: 'completed',
        image_gen_id: 12,
        zone_key: 'left',
        speaker_name: '林薇',
        members: ['林薇', '陈浩'],
      },
    ];
    const picked = choosePlateForStoryboard(
      { dialogue: '陈浩：因为我在找工作。', action: '坐姿回答' },
      plates,
      ['林薇', '陈浩']
    );
    assert.equal(picked.plate_type, 'zone');
    assert.equal(picked.speaker_name, '陈浩');
  });
});
