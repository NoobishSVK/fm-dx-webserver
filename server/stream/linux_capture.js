'use strict';

const DEFAULT_ALSA_LATENCY_PROFILE = 'low';

const ALSA_LATENCY_PROFILES = Object.freeze({
    experimental: Object.freeze({ bufferTime: 20000, periodTime: 5000 }),
    low: Object.freeze({ bufferTime: 40000, periodTime: 10000 }),
    stable: Object.freeze({ bufferTime: 80000, periodTime: 20000 }),
    system: Object.freeze({ bufferTime: null, periodTime: null })
});

const ALSA_PROFILE_FALLBACKS = Object.freeze({
    experimental: 'low',
    low: 'stable',
    stable: 'system',
    system: null
});

function resolveAlsaLatencyProfile(profileName) {
    const normalizedName = typeof profileName === 'string' ? profileName.toLowerCase() : '';
    const name = Object.hasOwn(ALSA_LATENCY_PROFILES, normalizedName)
        ? normalizedName
        : DEFAULT_ALSA_LATENCY_PROFILE;

    return {
        name,
        ...ALSA_LATENCY_PROFILES[name]
    };
}

function getAlsaFallbackProfile(profileName) {
    const { name } = resolveAlsaLatencyProfile(profileName);
    return ALSA_PROFILE_FALLBACKS[name];
}

function buildArecordArgs(device, channels, profileName) {
    const profile = resolveAlsaLatencyProfile(profileName);

    const args = [
        '-D', device,
        '-f', 'S16_LE',
        '-r', '48000',
        '-c', `${channels}`,
        '-t', 'raw'
    ];

    if (profile.bufferTime !== null) {
        args.push('--buffer-time', `${profile.bufferTime}`);
        args.push('--period-time', `${profile.periodTime}`);
    }

    return { args, profile };
}

function containsAlsaXrun(message) {
    return /(?:overrun|xrun)/i.test(message);
}

function containsAlsaSetupError(message) {
    return /(?:unable to set hw params|cannot set (?:buffer|period) time)/i.test(message);
}

module.exports = {
    ALSA_LATENCY_PROFILES,
    DEFAULT_ALSA_LATENCY_PROFILE,
    buildArecordArgs,
    containsAlsaSetupError,
    containsAlsaXrun,
    getAlsaFallbackProfile,
    resolveAlsaLatencyProfile
};
