const koffi = require('koffi');
const path = require('path');
const os = require('os');
const win32 = (os.platform() == "win32")
const unicode_type = (win32 ? 'int16_t' : 'int32_t')
const lib = koffi.load(path.join(__dirname, "librdsparser." + (win32 ? "dll" : "so")));

koffi.proto('void callback_pi(void *rds, void *user_data)');
koffi.proto('void callback_pty(void *rds, void *user_data)');
koffi.proto('void callback_tp(void *rds, void *user_data)');
koffi.proto('void callback_ta(void *rds, void *user_data)');
koffi.proto('void callback_ms(void *rds, void *user_data)');
koffi.proto('void callback_ecc(void *rds, void *user_data)');
koffi.proto('void callback_af(void *rds, uint32_t af, void *user_data)');
koffi.proto('void callback_ps(void *rds, void *user_data)');
koffi.proto('void callback_rt(void *rds, int flag, void *user_data)');
koffi.proto('void callback_ptyn(void *rds, void *user_data)');

const rdsparser = {
    new: lib.func('void* rdsparser_new()'),
    free: lib.func('void rdsparser_free(void *rds)'),
    parse_string: lib.func('bool rdsparser_parse_string(void *rds, const char *input)'),
    get_pi: lib.func('int32_t rdsparser_get_pi(void *rds)'),
    get_pty: lib.func('int8_t rdsparser_get_pty(void *rds)'),
    get_tp: lib.func('int8_t rdsparser_get_tp(void *rds)'),
    get_ta: lib.func('int8_t rdsparser_get_ta(void *rds)'),
    get_ms: lib.func('int8_t rdsparser_get_ms(void *rds)'),
    get_ecc: lib.func('int8_t rdsparser_get_ecc(void *rds)'),
    get_ps: lib.func('void* rdsparser_get_ps(void *rds)'),
    get_rt: lib.func('void* rdsparser_get_rt(void *rds, int flag)'),
    get_ptyn: lib.func('void* rdsparser_get_ptyn(void *rds)'),
    register_pi: lib.func('void rdsparser_register_pi(void *rds, callback_pi *cb)'),
    register_pty: lib.func('void rdsparser_register_pty(void *rds, callback_pty *cb)'),
    register_tp: lib.func('void rdsparser_register_tp(void *rds, callback_tp *cb)'),
    register_ta: lib.func('void rdsparser_register_ta(void *rds, callback_ta *cb)'),
    register_ms: lib.func('void rdsparser_register_ms(void *rds, callback_ms *cb)'),
    register_ecc: lib.func('void rdsparser_register_ecc(void *rds, callback_ecc *cb)'),
    register_af: lib.func('void rdsparser_register_af(void *rds, callback_af *cb)'),
    register_ps: lib.func('void rdsparser_register_ps(void *rds, callback_ps *cb)'),
    register_rt: lib.func('void rdsparser_register_rt(void *rds, callback_rt *cb)'),
    register_ptyn: lib.func('void rdsparser_register_ptyn(void *rds, callback_ptyn *cb)'),
    string_get_content: lib.func(unicode_type + '* rdsparser_string_get_content(void *string)'),
    string_get_length: lib.func('uint8_t rdsparser_string_get_length(void *string)')
}

const decode_unicode = function(string)
{
    let content = rdsparser.string_get_content(string);
    let length = rdsparser.string_get_length(string);
    let array = koffi.decode(content, koffi.array(unicode_type, length));
    return Buffer.from(array, 'utf-8').toString();
};

const callbacks =
{
    pi: koffi.register(rds => (
        value = rdsparser.get_pi(rds),
        console.log('PI: ' + value.toString(16).toUpperCase())
    ), 'callback_pi *'),

    pty: koffi.register(rds => (
        value = rdsparser.get_pty(rds),
        console.log('PTY: ' + value)
    ), 'callback_pty *'),

    tp: koffi.register(rds => (
        value = rdsparser.get_tp(rds),
        console.log('TP: ' + value)
    ), 'callback_tp *'),

    ta: koffi.register(rds => (
        value = rdsparser.get_ta(rds),
        console.log('TA: ' + value)
    ), 'callback_ta *'),

    ms: koffi.register(rds => (
        value = rdsparser.get_ms(rds),
        console.log('MS: ' + value)
    ), 'callback_ms *'),

    af: koffi.register((rds, value) => (
        console.log('AF: ' + value)
    ), 'callback_af *'),

    ecc: koffi.register(rds => (
        value = rdsparser.get_ecc(rds),
        console.log('ECC: ' + value.toString(16).toUpperCase())
    ), 'callback_ecc *'),

    ps: koffi.register(rds => (
        value = decode_unicode(rdsparser.get_ps(rds)),
        console.log('PS: ' + value)
    ), 'callback_ps *'),

    rt: koffi.register((rds, flag) => (
        value = decode_unicode(rdsparser.get_rt(rds, flag)),
        console.log('RT' + flag + ': ' + value)
    ), 'callback_rt *'),

    ptyn: koffi.register((rds, flag) => (
        value = decode_unicode(rdsparser.get_ptyn(rds)),
        console.log('PTYN: ' + value)
    ), 'callback_ptyn *')
}

let rds = rdsparser.new()
rdsparser.register_pi(rds, callbacks.pi)
rdsparser.register_pty(rds, callbacks.pty)
rdsparser.register_tp(rds, callbacks.tp)
rdsparser.register_ta(rds, callbacks.ta)
rdsparser.register_ms(rds, callbacks.ms)
rdsparser.register_ecc(rds, callbacks.ecc)
rdsparser.register_af(rds, callbacks.af)
rdsparser.register_ps(rds, callbacks.ps)
rdsparser.register_rt(rds, callbacks.rt)
rdsparser.register_ptyn(rds, callbacks.ptyn)

let data = [
    "34DB054A76CD445000",
    "34DB25504A757A2000",
    "34DB054FE4A42A2000",
    "34DB355800004BD700",
    "34DB054CA829202A00",
    "34DBC5400000000000",
    "34DB054976CD4B5200",
    "34DB25517A61206300",
    "34DB054AE4A4445000",
    "34DB25526877696C00",
    "34DB054FA8292A2000",
    "34DB2553653A204200",
    "34DB054C76CD202A00",
    "34DB255475646B6100",
    "34DB0549E4A44B5200",
    "34DB25552053756600",
    "34DB054AA829445000",
    "34DB25566C65726100",
    "34DB054F76CD2A2000",
    "34DB2557202D204300",
    "34DB054CE4A4202A00",
    "34DB25587A61732000",
    "34DB0549A8294B5200",
    "34DB25594F5F4F7700",
    "34DB054A76CD445000",
    "34DB255A69750D0D00",
    "34DB054FE4A42A2000",
    "34DB25405465726100",
    "34DB054CA829202A00",
    "34DB355800004BD700",
    "34DB054976CD4B5200",
    "34DBC558301821AF00",
    "34DB054AE4A4445000",
    "34DB25417A20677200",
    "34DB054FA8292A2000",
    "34DB2542616D793A00",
    "34DB054C76CD202A00",
    "34DB254320476F6C00",
    "34DB0549E4A44B5200",
    "34DB25446563205500",
    "34DB054AA829445000",
    "34DB25456F726B6900",
    "34DB054F76CD2A2000",
    "34DB25466573747200",
    "34DB054CE4A4202A00",
    "34DB254761202D2000",
    "34DB0549A8294B5200",
    "34DB25484E69652000",
    "34DB054A76CD445000",
    "34DB25494761732000",
    "34DB054FE4A42A2000",
    "34DB254A4475636800",
    "34DB054CA829202A00",
    "34DB254B61200D0D00",
    "34DB054976CD4B5200",
    "34DB25405465726100",
    "34DB054AE4A4445000",
    "34DB355800004BD700",
    "34DB054FA8292A2000",
    "34DBC548301821AF00",
    "34DB054C76CD202A00",
    "34DB25417A20677200",
    "34DB0549E4A44B5200",
    "34DB2542616D793A00",
    "34DB054AA829445000",
    "34DB254320476F6C00",
    "34DB054F76CD2A2000",
    "34DB25446563205500",
    "34DB054CE4A4202A00",
    "34DB25456F726B6900",
    "34DB0549A8294B5200",
    "34DB25466573747200",
    "34DB054A76CD445000",
    "34DB254761202D2000",
    "34DB054FE4A42A2000",
    "34DB25484E69652000",
    "34DB054CA829202A00",
    "34DB25494761732000",
    "34DB054976CD4B5200",
    "34DB254A4475636800",
    "34DB054AE4A4445000",
    "34DB254B61200D0D00",
    "34DB054FA8292A2000",
    "34DB25405465726100",
    "34DB054C76CD202A00",
    "34DB355800004BD700",
    "34DB0549E4A44B5200",
    "34DBC548301821AF00",
    "34DB054AA829445000",
    "34DB25417A20677200",
    "34DB054F76CD2A2000",
    "34DB2542616D793A00",
    "34DBA5505241444900",
    "34DBA5514F20372000"
]

for (let group of data)
{
    rdsparser.parse_string(rds, group);
}

for (let cb in callbacks)
{
    koffi.unregister(callbacks[cb]);
}

rdsparser.free(rds);
