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
koffi.proto('void callback_country(void *rds, void *user_data)');
koffi.proto('void callback_af(void *rds, uint32_t af, void *user_data)');
koffi.proto('void callback_ps(void *rds, void *user_data)');
koffi.proto('void callback_rt(void *rds, int flag, void *user_data)');
koffi.proto('void callback_ptyn(void *rds, void *user_data)');
koffi.proto('void callback_ct(void *rds, void *ct, void *user_data)');

const rdsparser = {
    new: lib.func('void* rdsparser_new()'),
    free: lib.func('void rdsparser_free(void *rds)'),
    clear: lib.func('void rdsparser_clear(void *rds)'),
    parse_string: lib.func('bool rdsparser_parse_string(void *rds, const char *input)'),
    get_pi: lib.func('int32_t rdsparser_get_pi(void *rds)'),
    get_pty: lib.func('int8_t rdsparser_get_pty(void *rds)'),
    get_tp: lib.func('int8_t rdsparser_get_tp(void *rds)'),
    get_ta: lib.func('int8_t rdsparser_get_ta(void *rds)'),
    get_ms: lib.func('int8_t rdsparser_get_ms(void *rds)'),
    get_ecc: lib.func('int16_t rdsparser_get_ecc(void *rds)'),
    get_country: lib.func('int rdsparser_get_country(void *rds)'),
    get_ps: lib.func('void* rdsparser_get_ps(void *rds)'),
    get_rt: lib.func('void* rdsparser_get_rt(void *rds, int flag)'),
    get_ptyn: lib.func('void* rdsparser_get_ptyn(void *rds)'),
    register_pi: lib.func('void rdsparser_register_pi(void *rds, callback_pi *cb)'),
    register_pty: lib.func('void rdsparser_register_pty(void *rds, callback_pty *cb)'),
    register_tp: lib.func('void rdsparser_register_tp(void *rds, callback_tp *cb)'),
    register_ta: lib.func('void rdsparser_register_ta(void *rds, callback_ta *cb)'),
    register_ms: lib.func('void rdsparser_register_ms(void *rds, callback_ms *cb)'),
    register_ecc: lib.func('void rdsparser_register_ecc(void *rds, callback_ecc *cb)'),
    register_country: lib.func('void rdsparser_register_country(void *rds, callback_country *cb)'),
    register_af: lib.func('void rdsparser_register_af(void *rds, callback_af *cb)'),
    register_ps: lib.func('void rdsparser_register_ps(void *rds, callback_ps *cb)'),
    register_rt: lib.func('void rdsparser_register_rt(void *rds, callback_rt *cb)'),
    register_ptyn: lib.func('void rdsparser_register_ptyn(void *rds, callback_ptyn *cb)'),
    register_ct: lib.func('void rdsparser_register_ct(void *rds, callback_ct *cb)'),
    string_get_content: lib.func(unicode_type + '* rdsparser_string_get_content(void *string)'),
    string_get_length: lib.func('uint8_t rdsparser_string_get_length(void *string)'),
    ct_get_year: lib.func('uint16_t rdsparser_ct_get_year(void *ct)'),
    ct_get_month: lib.func('uint8_t rdsparser_ct_get_month(void *ct)'),
    ct_get_day: lib.func('uint8_t rdsparser_ct_get_day(void *ct)'),
    ct_get_hour: lib.func('uint8_t rdsparser_ct_get_hour(void *ct)'),
    ct_get_minute: lib.func('uint8_t rdsparser_ct_get_minute(void *ct)'),
    ct_get_offset: lib.func('int8_t rdsparser_ct_get_offset(void *ct)'),
    pty_lookup_short: lib.func('const char* rdsparser_pty_lookup_short(int8_t pty, bool rbds)'),
    pty_lookup_long: lib.func('const char* rdsparser_pty_lookup_long(int8_t pty, bool rbds)'),
    country_lookup_name: lib.func('const char* rdsparser_country_lookup_name(int country)'),
    country_lookup_iso: lib.func('const char* rdsparser_country_lookup_iso(int country)')
}

const decode_unicode = function(string) {
    let content = rdsparser.string_get_content(string);
    let length = rdsparser.string_get_length(string);
    let array = koffi.decode(content, koffi.array(unicode_type, length));
    return Buffer.from(array, 'utf-8').toString();
};

const callbacks = {
    pi: koffi.register(rds => (
        value = rdsparser.get_pi(rds),
        console.log('PI: ' + value.toString(16).toUpperCase())
    ), 'callback_pi*'),

    pty: koffi.register(rds => (
        value = rdsparser.get_pty(rds),
        display = rdsparser.pty_lookup_long(value, false),
        console.log('PTY: ' + display + ' (' + value + ')')
    ), 'callback_pty*'),

    tp: koffi.register(rds => (
        value = rdsparser.get_tp(rds),
        console.log('TP: ' + value)
    ), 'callback_tp*'),

    ta: koffi.register(rds => (
        value = rdsparser.get_ta(rds),
        console.log('TA: ' + value)
    ), 'callback_ta*'),

    ms: koffi.register(rds => (
        value = rdsparser.get_ms(rds),
        console.log('MS: ' + value)
    ), 'callback_ms*'),

    af: koffi.register((rds, value) => (
        console.log('AF: ' + value)
    ), 'callback_af*'),

    ecc: koffi.register(rds => (
        value = rdsparser.get_ecc(rds),
        console.log('ECC: ' + value.toString(16).toUpperCase())
    ), 'callback_ecc*'),

    country: koffi.register(rds => (
        value = rdsparser.get_country(rds),
        display = rdsparser.country_lookup_name(value),
        iso = rdsparser.country_lookup_iso(value),
        console.log('Country: ' + display + ' (' + iso + ')')
    ), 'callback_country*'),

    ps: koffi.register(rds => (
        value = decode_unicode(rdsparser.get_ps(rds)),
        console.log('PS: ' + value)
    ), 'callback_ps*'),

    rt: koffi.register((rds, flag) => (
        value = decode_unicode(rdsparser.get_rt(rds, flag)),
        console.log('RT' + flag + ': ' + value)
    ), 'callback_rt*'),

    ptyn: koffi.register((rds, flag) => (
        value = decode_unicode(rdsparser.get_ptyn(rds)),
        console.log('PTYN: ' + value)
    ), 'callback_ptyn*'),

    ct: koffi.register((rds, ct) => (
        year = rdsparser.ct_get_year(ct),
        month = String(rdsparser.ct_get_month(ct)).padStart(2, '0'),
        day = String(rdsparser.ct_get_day(ct)).padStart(2, '0'),
        hour = String(rdsparser.ct_get_hour(ct)).padStart(2, '0'),
        minute = String(rdsparser.ct_get_minute(ct)).padStart(2, '0'),
        offset = rdsparser.ct_get_offset(ct),
        tz_sign = (offset >= 0 ? '+' : '-'),
        tz_hour = String(Math.abs(Math.floor(offset / 60))).padStart(2, '0'),
        tz_minute = String(Math.abs(offset % 60)).padStart(2, '0'),
        console.log('CT: ' + year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ' (' + tz_sign + tz_hour + ':' + tz_minute + ')')
    ), 'callback_ct*')
}

let rds = rdsparser.new()
rdsparser.register_pi(rds, callbacks.pi)
rdsparser.register_pty(rds, callbacks.pty)
rdsparser.register_tp(rds, callbacks.tp)
rdsparser.register_ta(rds, callbacks.ta)
rdsparser.register_ms(rds, callbacks.ms)
rdsparser.register_ecc(rds, callbacks.ecc)
rdsparser.register_country(rds, callbacks.country)
rdsparser.register_af(rds, callbacks.af)
rdsparser.register_ps(rds, callbacks.ps)
rdsparser.register_rt(rds, callbacks.rt)
rdsparser.register_ptyn(rds, callbacks.ptyn)
rdsparser.register_ct(rds, callbacks.ct)

let data = [
    "323305487F1C202001",
    "3233054AE5113A3110",
    "3233054F7F1C392000",
    "32330548767B507400",
    "3233054A7F1C792000",
    "3233054F767B202010",
    "32330548E31150741C",
    "323305497F1C616B00",
    "3233054A767B792000",
    "323305487F1C507405",
    "32330549767B616B04",
    "3233054AE511792000",
    "3233054F7F1C102003",
    "323365550000000300",
    "32330548E511507400",
    "323305497F1C616B01",
    "3233054A767B792000",
    "3233054FE511202000",
    "32330549767B616B00",
    "3233054AE511792000",
    "3233054F7F1C202014",
    "32330548767B507400",
    "32330549E511616B00",
    "32330548767B507400",
    "32330549E511616B00",
    "3233054A7F1C792000",
    "32333557767B202015",
    "32333544E511507431",
    "3233054A767B792000",
    "3233054FE511202004",
    "323305487F1C507404",
    "3233434F767B616B10",
    "3233054AE511792000",
    "3233054F7F1C202000",
    "32330548E511426F00",
    "323305497F1C6A6100",
    "3233054A767B207300",
    "3233054FE511696500",
    "32330549767B6A6104",
    "3233054AE511207300",
    "3233054F7F1C696501",
    "32330549E5116A6110",
    "32334541D754C50010",
    "3233054A7F1C207301",
    "32330548767B426F00",
    "32330549E5116A6104",
    "3233054F767B696500",
    "32330548E511426F01",
    "323305497F1C6A6104",
    "3233054A767B207300",
    "32330549767B6A6104",
    "3233054AE50920730C",
    "3233054F7F1C696500",
    "32330548767B426F04",
    "32330548E511426F10",
    "3233054A767B207301",
    "3233054FE511696510",
    "32330549767B6A6100",
    "3233054AE511207300",
    "3233054F7F1C696504",
    "32330549E5116A6100",
    "3233054A7F1C207310",
    "3233054F767B696500",
    "32330548E511426F00",
    "323305497F1C6A6100",
    "323365550000000310",
    "32330549E511647A04",
    "3233054A7F1C696514",
    "323325502A2A545206",
    "32330548E5116C7510",
    "323305497F1C647A00",
    "3233054A767B696500",
    "3233054FE511202005",
    "323305487F1C6C7500",
    "32330549767B647A10",
    "3233054AE511696500",
    "323325522A2A205000",
    "32330549767B647A00",
    "3233054AE511696510",
    "3233054F7F1C202000",
    "32330548767B6C7500",
    "32330549E511647A00",
    "3233054A7F1C696500",
    "3233054F767B202001",
    "323325546965205205",
    "323305497F1C647A00",
    "32330548767B6C7511",
    "32330549E511647513",
    "3233054A7F1C696501",
    "3233054F767B202000",
    "32330548E5116C7500",
    "323305497F1C647A00",
    "323325562050726F00",
    "3233054FE511202010",
    "323305487F1C6C7501",
    "32330549767B647A00",
    "32330548E511205000",
    "323305497F1C6F6C00",
    "3233054FE511696510",
    "323305487F1C205001",
    "323325582054727A00",
    "32330549767B6F6C01",
    "3233054F7F1C696510",
    "32330548767B205000",
    "323325596563692001",
    "323305487F1C205000",
    "32330549767B6F6C00",
    "3233054AE511736B00",
    "3233255A2020202000",
    "3233054F7F1C696504",
    "32330549E5116F6C00",
    "3233054A7F1C736B05",
    "3233255B2020202000",
    "3233054F767B696501",
    "32330548E511205001",
    "323305497F1C6F6C04",
    "3233054A767B736B10",
    "3233255C2020202000",
    "323365550000000300",
    "323305497F1C6F6C01"
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
