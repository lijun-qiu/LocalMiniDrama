const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractJsonObject, parseFoleyEventsJson, FRAME_INTERVAL_SEC } = require('../src/services/foleyService');

describe('foleyService helpers', () => {
  it('uses 3s frame interval', () => {
    assert.equal(FRAME_INTERVAL_SEC, 3);
  });

  it('extracts JSON from fenced reply', () => {
    const parsed = extractJsonObject('```json\n{"events":[{"label":"door_close"}]}\n```');
    assert.equal(parsed.events[0].label, 'door_close');
  });

  it('parses stored foley events json', () => {
    const payload = parseFoleyEventsJson(JSON.stringify({
      events: [{ id: 'a', status: 'pending' }],
      analyzed_at: '2026-01-01',
    }));
    assert.equal(payload.events.length, 1);
    assert.equal(payload.analyzed_at, '2026-01-01');
  });
});
