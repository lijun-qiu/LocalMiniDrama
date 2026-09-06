const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  faceCropSiblingPath,
  looksLikeCharacterReferenceSheet,
  ensureCharacterFaceHeroCrop,
  pickCharacterRefForStoryboard,
  SHEET_MIN_ASPECT,
} = require('../src/utils/characterStoryboardRef');

async function writeSolidJpeg(absPath, width, height) {
  const sharp = require('sharp');
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 80, b: 120 },
    },
  })
    .jpeg()
    .toBuffer();
  fs.writeFileSync(absPath, buf);
}

describe('characterStoryboardRef', () => {
  it('detects wide sheet vs tall portrait', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'char-ref-'));
    const wide = path.join(dir, 'wide.jpg');
    const tall = path.join(dir, 'tall.jpg');
    await writeSolidJpeg(wide, 1792, 1024);
    await writeSolidJpeg(tall, 768, 1024);
    assert.equal(await looksLikeCharacterReferenceSheet(wide), true);
    assert.equal(await looksLikeCharacterReferenceSheet(tall), false);
    assert.ok(1792 / 1024 >= SHEET_MIN_ASPECT);
  });

  it('crops FACE HERO from wide sheet and reuses cache', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'char-ref-'));
    const sheet = path.join(dir, 'chenhao.jpg');
    await writeSolidJpeg(sheet, 1792, 1024);
    const crop1 = await ensureCharacterFaceHeroCrop(sheet, null);
    assert.ok(crop1);
    assert.equal(crop1, faceCropSiblingPath(sheet));
    assert.ok(fs.existsSync(crop1));
    const mtime1 = fs.statSync(crop1).mtimeMs;
    const crop2 = await ensureCharacterFaceHeroCrop(sheet, null);
    assert.equal(crop2, crop1);
    assert.equal(fs.statSync(crop2).mtimeMs, mtime1);
  });

  it('pickCharacterRefForStoryboard prefers face crop over full sheet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'char-ref-'));
    const storageRoot = dir;
    const rel = 'projects/demo/characters/sheet.jpg';
    const abs = path.join(storageRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await writeSolidJpeg(abs, 1792, 1024);

    const picked = await pickCharacterRefForStoryboard(
      null,
      128,
      { local_path: rel, image_url: null, ref_image: null },
      storageRoot,
      null
    );
    assert.equal(picked.isFaceCrop, true);
    assert.equal(picked.isUserRef, false);
    assert.match(picked.charRef, /_face_ref\.jpg$/);
    assert.ok(fs.existsSync(path.join(storageRoot, picked.charRef)));
  });

  it('pickCharacterRefForStoryboard keeps user ref_image untouched', async () => {
    const picked = await pickCharacterRefForStoryboard(
      null,
      1,
      {
        ref_image: 'projects/demo/characters/user_upload.png',
        local_path: 'projects/demo/characters/sheet.jpg',
        image_url: null,
      },
      null,
      null
    );
    assert.equal(picked.isUserRef, true);
    assert.equal(picked.isFaceCrop, false);
    assert.equal(picked.charRef, 'projects/demo/characters/user_upload.png');
  });
});
