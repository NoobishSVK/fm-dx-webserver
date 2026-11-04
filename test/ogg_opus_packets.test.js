'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OggOpusPackets } = require('../server/stream/ogg_opus_packets');
const { spawnSync } = require('node:child_process');

function page(sequence, lengths, payload, flags = 0) {
    const header = Buffer.alloc(27 + lengths.length);
    header.write('OggS');
    header[5] = flags;
    header.writeUInt32LE(sequence, 18);
    header[26] = lengths.length;
    Buffer.from(lengths).copy(header, 27);
    return Buffer.concat([header, payload]);
}

test('extracts packets across page and pipe chunk boundaries', () => {
    const parser = new OggOpusPackets();
    const head = page(0, [8], Buffer.from('OpusHead'));
    const first = page(1, [255], Buffer.alloc(255, 1));
    const last = page(2, [2, 3], Buffer.from([2, 3, 4, 5, 6]), 1);
    const data = Buffer.concat([head, first, last]);
    const result = [];
    for (let i = 0; i < data.length; i += 13) result.push(...parser.push(data.subarray(i, i + 13)));
    assert.equal(result.length, 2);
    assert.equal(result[0].length, 257);
    assert.deepEqual([...result[1]], [4, 5, 6]);
});

test('rejects lost pages and malformed input', () => {
    const parser = new OggOpusPackets();
    parser.push(page(0, [1], Buffer.from([1])));
    assert.throws(() => parser.push(page(2, [1], Buffer.from([2]))), /Missing Ogg page/);
    assert.throws(() => new OggOpusPackets().push(Buffer.alloc(27)), /Invalid Ogg/);
});

test('parses real FFmpeg Opus output split into small chunks', t => {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000', '-t', '0.5', '-c:a', 'libopus', '-frame_duration', '20', '-f', 'ogg', '-page_duration', '20000', 'pipe:1'], { maxBuffer: 1024 * 1024 });
    if (result.error && result.error.code === 'ENOENT') return t.skip('FFmpeg not installed');
    assert.equal(result.status, 0, result.stderr.toString());
    const parser = new OggOpusPackets();
    let packets = [];
    for (let offset = 0; offset < result.stdout.length; offset += 37) packets.push(...parser.push(result.stdout.subarray(offset, offset + 37)));
    assert.ok(packets.length >= 24, `expected at least 24 Opus packets, received ${packets.length}`);
    assert.ok(packets.every(packet => packet.length > 0));
});
