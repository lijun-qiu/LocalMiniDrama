const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isRemoteCallScene, extractCallReceiverName } = require('../src/utils/storyboardCallReceiver');

describe('storyboardCallReceiver', () => {
  it('detects remote call scenes', () => {
    assert.equal(isRemoteCallScene('陆沉打来视频电话'), true);
    assert.equal(isRemoteCallScene('手机响起，语音电话接通'), true);
    assert.equal(isRemoteCallScene('两人在咖啡厅面对面聊天'), false);
  });

  it('extracts call receiver from action text', () => {
    const names = ['陆沉', '陆薇'];
    assert.equal(
      extractCallReceiverName('手机响起，陆薇接起视频电话，屏幕里是陆沉', names),
      '陆薇'
    );
    assert.equal(
      extractCallReceiverName('陆沉接听语音电话，神情凝重', names),
      '陆沉'
    );
  });

  it('returns null when receiver cannot be identified', () => {
    assert.equal(extractCallReceiverName('视频电话那头传来声音', ['陆沉', '陆薇']), null);
  });
});
