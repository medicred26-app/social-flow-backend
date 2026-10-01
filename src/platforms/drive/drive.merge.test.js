import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { escapeConcatPath, mergeLocalVideos, runFfmpeg, validateMergeInput } from './drive.merge.js';

describe('validateMergeInput', () => {
  it('rejects fewer than two clips', () => {
    const result = validateMergeInput({ fileIds: ['only-one'] });
    assert.equal(result.ok, false);
  });

  it('rejects more than eight clips', () => {
    const result = validateMergeInput({ fileIds: Array.from({ length: 9 }, (_, i) => `id-${i}`) });
    assert.equal(result.ok, false);
  });

  it('accepts two to eight unique ids', () => {
    const result = validateMergeInput({ fileIds: [' a ', 'a', 'b'], title: '  Launch reel  ' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.fileIds, ['a', 'b']);
    assert.equal(result.title, 'Launch reel');
  });
});

describe('escapeConcatPath', () => {
  it('normalizes windows paths for ffmpeg concat', () => {
    assert.equal(escapeConcatPath('C:\\temp\\clip.mp4'), 'C:/temp/clip.mp4');
  });
});

describe('mergeLocalVideos', () => {
  it('concatenates two short generated clips into one mp4', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sf-merge-test-'));
    const clipA = path.join(dir, 'a.mp4');
    const clipB = path.join(dir, 'b.mp4');
    const out = path.join(dir, 'out.mp4');
    try {
      await runFfmpeg([
        '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clipA,
      ], 60000);
      await runFfmpeg([
        '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clipB,
      ], 60000);
      await mergeLocalVideos([clipA, clipB], out);
      const info = await stat(out);
      assert.ok(info.size > 1000, 'merged file should have video bytes');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
