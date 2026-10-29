'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('a failed decode releases later audio in order', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/js/3las/fallback/3las.formatreader.js'), 'utf8'), context);
    const reader = new context.AudioFormatReader({}, {}, () => {}, () => true, () => {});
    const first = { duration: 1 }, third = { duration: 3 };
    reader.OnDataReady(2, third);
    reader.OnDataReady(1, null);
    reader.OnDataReady(0, first);
    assert.equal(reader.PopSamples(), first);
    assert.equal(reader.PopSamples(), third);
    assert.equal(reader.PopSamples(), null);
    const generation = reader.Generation;
    reader.PurgeData();
    assert.equal(reader.Generation, generation + 1);
});
