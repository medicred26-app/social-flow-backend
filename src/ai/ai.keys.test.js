import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskApiKey, validateClientApiKey, validateVideoPrompt } from './ai.keys.js';
import { validateUpload } from '../media/media.store.js';

describe('client API key', () => {
  it('rejects empty or tiny keys', () => {
    assert.equal(validateClientApiKey('').ok, false);
    assert.equal(validateClientApiKey('short').ok, false);
  });

  it('accepts a long Gemini-style key and masks it', () => {
    const key = 'AIzaSyDummyTestKeyValue1234567890';
    const parsed = validateClientApiKey(` ${key} `);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.apiKey, key);
    assert.equal(maskApiKey(key).includes('…'), true);
    assert.equal(maskApiKey(key).includes('1234567890'), false);
  });
});

describe('direct video prompt', () => {
  it('requires a real prompt', () => {
    assert.equal(validateVideoPrompt('hi').ok, false);
    assert.equal(validateVideoPrompt('A 30 second product reel in a bright studio').ok, true);
  });
});

describe('direct upload', () => {
  it('accepts mp4 and rejects other files', () => {
    assert.equal(validateUpload({ originalname: 'clip.mp4', mimetype: 'video/mp4', size: 1200 }).ok, true);
    assert.equal(validateUpload({ originalname: 'notes.pdf', mimetype: 'application/pdf', size: 1200 }).ok, false);
    assert.equal(validateUpload({ originalname: 'clip.mp4', mimetype: 'video/mp4', size: 0 }).ok, false);
  });
});
