/*
    Minimal platform flags for UI logic
*/
var isAndroid;
var isIOS;
var isIPadOS;
var isSafari;
var forceMp3Codec;
{
    var ua = navigator.userAgent.toLowerCase();
    isAndroid = (ua.indexOf('android') !== -1);
    isIOS = (/iphone|ipod/.test(ua));
    isIPadOS = (ua.indexOf('ipad') !== -1) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    isSafari = /safari/.test(ua) && !/chrome|chromium|crios|fxios|edg/.test(ua);
    // WebKit-based browsers have unreliable Opus-in-WebM MSE playback —
    // on iOS/iPadOS all browsers are WebKit, on desktop only Safari is.
    forceMp3Codec = isIOS || isIPadOS || isSafari;
}
