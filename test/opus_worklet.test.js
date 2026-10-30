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
