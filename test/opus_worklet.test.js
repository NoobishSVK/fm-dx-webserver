'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function createWorklet() {
    let Processor;
    const messages = [];
    class AudioWorkletProcessor { constructor() { this.port = { postMessage: message => messages.push(message) }; } }
    const context = vm.createContext({ AudioWorkletProcessor, sampleRate: 48000, registerProcessor(_name, type) { Processor = type; } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/js/opus-worklet.js'), 'utf8'), context);
    return { processor: new Processor(), messages };
}

test('buffers before playback and reports underruns', () => {
    const { processor, messages } = createWorklet();
    processor.port.onmessage({ data: { type: 'audio', channels: [new Float32Array(9600).fill(0.5)] } });
    const output = [[new Float32Array(128), new Float32Array(128)]];
    processor.process([], output);
    assert.equal(output[0][0][0], 0.5);
    for (let i = 0; i < 76; i++) processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(messages[0].type, 'underrun');
    assert.equal(processor.started, false);
});

test('limits accumulated decoded audio', () => {
    const { processor, messages } = createWorklet();
    for (let i = 0; i < 35; i++) processor.port.onmessage({ data: { type: 'audio', channels: [new Float32Array(960)] } });
    assert.ok(processor.frames <= processor.maximum);
    assert.ok(messages.some(message => message.type === 'drop'));
});

test('interpolates continuously across packet boundaries and preserves stereo', () => {
    const { processor } = createWorklet();
    for (let packet = 0; packet < 10; packet++) {
        const left = Float32Array.from({ length: 960 }, (_, i) => packet * 960 + i);
        const right = Float32Array.from(left, value => -value);
        processor.port.onmessage({ data: { type: 'audio', channels: [left, right] } });
    }
    let previous = -1;
    for (let block = 0; block < 50; block++) {
        const output = [[new Float32Array(128), new Float32Array(128)]];
        processor.process([], output);
        for (let i = 0; i < 128; i++) {
            const left = output[0][0][i];
            assert.ok(left - previous > 0.997 && left - previous < 1.003);
            assert.equal(output[0][1][i], -left);
            previous = left;
        }
    }
});

for (const drift of [-0.0005, 0.0005]) {
    test(`tracks ${drift * 1e6} ppm clock drift for 20 minutes without gaps or drops`, () => {
        const { processor, messages } = createWorklet();
        const output = [[new Float32Array(128), new Float32Array(128)]];
        const packet = [new Float32Array(960).fill(0.25)];
        let nextPacket = 0;
        for (let frame = 0; frame < 48000 * 1200; frame += 128) {
            while (nextPacket <= frame) {
                processor.port.onmessage({ data: { type: 'audio', channels: packet } });
                nextPacket += 960 / (1 + drift);
            }
            processor.process([], output);
        }
        assert.equal(messages.filter(m => m.type === 'underrun' || m.type === 'drop').length, 0);
        assert.ok(processor.frames > 48000 * 0.1 && processor.frames < 48000 * 0.25);
        assert.equal(output[0][0][0], 0.25);
    });
}
