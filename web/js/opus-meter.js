// Digital input meter for the Peak Meter plugin. Levels come from ALSA capture,
// not from the browser output or volume control.
(() => {
    'use strict';
    function init() {
        if (document.getElementById('peak-meter-container')) return;
        const frequency = document.getElementById('freq-container');
        if (!frequency) return;
        const panel = document.createElement('section');
        panel.id = 'peak-meter-container';
        panel.className = 'panel-100';
        panel.innerHTML = `<h2><button type="button" class="meter-toggle" aria-pressed="false" aria-label="Show stereo spectrum">Audio levels</button></h2>
            <p class="meter-caption meter-description">Tuner input level · independent of playback volume</p>
            <div class="meter-channels"></div>
            <div class="meter-scale"><span>−90</span><span>−60</span><span>−30</span><span>0 dBFS</span></div>
            <p class="meter-caption meter-status">Start audio to show input levels</p>
            <div class="meter-spectrum" hidden><canvas aria-label="Left and right audio frequency spectrum" role="img"></canvas><p class="meter-caption spectrum-status"></p></div>
            <p class="meter-caption meter-hint">Click to switch view</p>`;
        const style = document.createElement('style');
        style.textContent = `
            #peak-meter-container {box-sizing:border-box;padding:12px 20px;min-width:0;}
            #peak-meter-container h2 {font-size:20px;margin:0;}
            #peak-meter-container {cursor:pointer;}
            #peak-meter-container [hidden] {display:none!important;}
            #peak-meter-container .meter-toggle {font:inherit;color:inherit;background:none;border:0;padding:0;min-width:0;height:auto;cursor:pointer;}
            #peak-meter-container .meter-toggle:focus-visible {outline:2px solid currentColor;outline-offset:5px;}
            #peak-meter-container .meter-spectrum canvas {display:block;width:100%;height:220px;}
            #peak-meter-container .meter-hint {font-size:10px;opacity:.55;}
            #peak-meter-container .meter-caption {font-size:12px;margin:4px 0;opacity:.8;}
            #peak-meter-container .meter-row {display:grid;grid-template-columns:28px minmax(40px,1fr) 72px;gap:8px;align-items:center;margin:8px 0;}
            #peak-meter-container .meter-track {height:14px;background:rgba(0,0,0,.35);position:relative;overflow:hidden;border-radius:3px;}
            #peak-meter-container .meter-fill {position:absolute;inset:0;transform:scaleX(0);transform-origin:left;background:linear-gradient(to right,#2cba73 0%,#2cba73 86.6%,#e8c84b 86.6%,#e8c84b 96.6%,#e65a5a 96.6%);}
            #peak-meter-container .meter-hold {position:absolute;top:0;bottom:0;width:2px;background:white;display:none;}
            #peak-meter-container .meter-value {font-size:13px;text-align:right;font-variant-numeric:tabular-nums;}
            #peak-meter-container .meter-scale {display:flex;justify-content:space-between;margin:0 80px 0 36px;font-size:11px;}
        `;
        document.head.appendChild(style);
        frequency.parentElement.after(panel);
        const container = panel.querySelector('.meter-channels');
        const status = panel.querySelector('.meter-status');
        const spectrum = panel.querySelector('.meter-spectrum');
        const canvas = spectrum.querySelector('canvas');
        const spectrumStatus = panel.querySelector('.spectrum-status');
        const toggle = panel.querySelector('.meter-toggle');
        let spectrumView = false, spectrumSession = null, spectrumPending = false, spectrumGeneration = 0, animation;
        function stopSpectrum() {
            spectrumGeneration++;
            spectrumPending = false;
            cancelAnimationFrame(animation);
            if (spectrumSession) {
                spectrumSession.source.disconnect();
                spectrumSession.splitter.disconnect();
                spectrumSession.analysers.forEach(node => node.disconnect());
                spectrumSession.tap.release();
                spectrumSession = null;
            }
        }
        function drawSpectrum() {
            if (!spectrumView) return;
            const width = canvas.clientWidth || 600, height = 220;
            const ratio = window.devicePixelRatio || 1;
            if (canvas.width !== Math.round(width * ratio) || canvas.height !== height * ratio) {
                canvas.width = Math.round(width * ratio); canvas.height = height * ratio;
            }
            const ctx = canvas.getContext('2d');
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, width, height);
            const left = 30, usable = width - 42, bands = Math.max(12, Math.min(48, Math.floor(usable / 12)));
            const bandWidth = usable / bands;
            const textColor = getComputedStyle(panel).color;
            for (let channel = 0; channel < 2; channel++) {
                const top = channel * 105 + 6, bottom = top + 76;
                ctx.font = '12px sans-serif'; ctx.fillStyle = textColor; ctx.textAlign = 'left';
                ctx.fillText(channel ? 'R' : 'L', 4, top + 42);
                const gradient = ctx.createLinearGradient(0, bottom, 0, top);
                gradient.addColorStop(0, channel ? '#389eff' : '#22c998');
                gradient.addColorStop(.65, '#62e8e1'); gradient.addColorStop(1, '#f2d365');
                const session = spectrumSession;
                if (session) session.analysers[channel].getFloatFrequencyData(session.bins[channel]);
                for (let band = 0; band < bands; band++) {
                    const x = left + band * bandWidth;
                    ctx.fillStyle = 'rgba(100,200,190,.08)'; ctx.fillRect(x, top, bandWidth - 3, 76);
                    let db = -90;
                    if (session) {
                        const binHz = session.context.sampleRate / session.analysers[channel].fftSize;
                        const start = Math.max(1, Math.floor(40 * (16000 / 40) ** (band / bands) / binHz));
                        const end = Math.min(session.bins[channel].length, Math.max(start + 1, Math.ceil(40 * (16000 / 40) ** ((band + 1) / bands) / binHz)));
                        for (let bin = start; bin < end; bin++) db = Math.max(db, session.bins[channel][bin]);
                    }
                    const barHeight = Math.max(0, Math.min(1, (db + 90) / 90)) * 76;
                    ctx.fillStyle = gradient; ctx.fillRect(x, bottom - barHeight, bandWidth - 3, barHeight);
                    if (barHeight > 1) { ctx.fillStyle = '#ddffff'; ctx.fillRect(x, bottom - barHeight, bandWidth - 3, 2); }
                }
                ctx.font = '10px sans-serif'; ctx.fillStyle = textColor;
                for (const hz of [40, 100, 1000, 10000, 16000]) {
                    ctx.textAlign = hz === 40 ? 'left' : hz === 16000 ? 'right' : 'center';
                    ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}`, left + Math.log(hz / 40) / Math.log(16000 / 40) * usable, bottom + 15);
                }
            }
            animation = requestAnimationFrame(drawSpectrum);
        }
        async function startSpectrum() {
            if (!spectrumView || spectrumSession || spectrumPending) return;
            const output = window.fmdxAudio?.getOutput();
            if (!output) { spectrumStatus.textContent = 'Audio stopped · press Play to show the spectrum'; return; }
            spectrumPending = true;
            const id = ++spectrumGeneration;
            let tap, source, splitter;
            try {
                tap = await window.fmdxAudio.createStream();
                if (!spectrumView || id !== spectrumGeneration || window.fmdxAudio.getOutput() !== output) { tap.release(); return; }
                const context = output.context;
                source = context.createMediaStreamSource(tap.stream);
                splitter = context.createChannelSplitter(2);
                source.connect(splitter);
                const analysers = [0, 1].map(channel => {
                    const analyser = context.createAnalyser();
                    analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.75;
                    splitter.connect(analyser, channel);
                    return analyser;
                });
                spectrumSession = { tap, source, splitter, analysers, context, bins: analysers.map(node => new Float32Array(node.frequencyBinCount)) };
                spectrumStatus.textContent = 'Left / right · frequency in Hz · visualisation only';
            } catch (error) {
                source?.disconnect(); splitter?.disconnect(); tap?.release();
                if (id === spectrumGeneration) spectrumStatus.textContent = 'Spectrum unavailable: ' + error.message;
            } finally { if (id === spectrumGeneration) spectrumPending = false; }
        }
        panel.addEventListener('click', () => {
            spectrumView = !spectrumView;
            toggle.textContent = spectrumView ? 'Stereo spectrum' : 'Audio levels';
            toggle.setAttribute('aria-label', spectrumView ? 'Show audio levels' : 'Show stereo spectrum');
            toggle.setAttribute('aria-pressed', String(spectrumView));
            panel.querySelector('.meter-description').textContent = spectrumView
                ? 'Bass to treble · independent of playback volume'
                : 'Tuner input level · independent of playback volume';
            container.hidden = status.hidden = panel.querySelector('.meter-scale').hidden = spectrumView;
            spectrum.hidden = !spectrumView;
            if (spectrumView) { startSpectrum(); drawSpectrum(); }
            else stopSpectrum();
        });
        let rows = [], count = 0, lastReading = null;
        const position = db => db === null ? 0 : Math.max(0, Math.min(1, (db + 90) / 90));
        const value = db => db === null ? '−∞' : db.toFixed(1);
        function update(reading = window.fmdxAudio?.getInputLevels?.()) {
            const channels = reading?.channels;
            const channelCount = channels?.length || count || 2;
            if (channelCount !== count) {
                count = channelCount;
                container.replaceChildren();
                rows = Array.from({ length: count }, (_, i) => {
                    const row = document.createElement('div');
                    row.className = 'meter-row';
                    row.innerHTML = `<span>${count === 1 ? 'M' : ['L', 'R'][i]}</span><div class="meter-track"><div class="meter-fill"></div><div class="meter-hold"></div></div><span class="meter-value"></span>`;
                    container.appendChild(row);
                    return { fill: row.querySelector('.meter-fill'), hold: row.querySelector('.meter-hold'), text: row.querySelector('.meter-value'), peak: null, until: 0 };
                });
            }
            if (!reading) {
                rows.forEach(row => { row.fill.style.clipPath = 'inset(0 100% 0 0)'; row.hold.style.display = 'none'; row.text.textContent = '—'; row.text.title = 'No input reading'; row.peak = null; });
                status.textContent = window.fmdxAudio?.getOutput?.()
                    ? 'Waiting for input levels…'
                    : 'Audio stopped · press Play to show input levels';
                lastReading = null;
                return;
            }
            if (reading === lastReading) return;
            lastReading = reading;
            const now = performance.now();
            channels.forEach((channel, i) => {
                const row = rows[i];
                // Clip the fixed gradient so its colours always correspond to
                // -12 dBFS (yellow) and -3 dBFS (red), regardless of bar length.
                row.fill.style.transform = 'none';
                row.fill.style.clipPath = `inset(0 ${(1 - position(channel.peakDb)) * 100}% 0 0)`;
                if (row.peak === null || channel.peakDb !== null && channel.peakDb >= row.peak || now >= row.until) {
                    row.peak = channel.peakDb;
                    row.until = now + 1000;
                }
                row.hold.style.display = row.peak === null ? 'none' : 'block';
                row.hold.style.left = `calc(${position(row.peak) * 100}% - 2px)`;
                row.text.textContent = value(channel.peakDb);
                row.text.title = `Sample peak: ${value(channel.peakDb)} dBFS; RMS: ${value(channel.rmsDb)} dBFS`;
            });
            status.textContent = channels.some(channel => channel.fullScale)
                ? 'Digital full scale reached — check tuner output level'
                : `${count === 1 ? 'Mono' : 'Left / right'} · peak held for 1 second · 0 dBFS is the digital maximum`;
        }
        update();
        let expiry;
        const unsubscribe = window.fmdxAudio?.subscribe(event => {
            if (event.type === 'levels') {
                clearTimeout(expiry);
                update(event.levels);
                expiry = setTimeout(() => update(null), 1500);
            } else if (event.type === 'state' && event.state !== 'receiving') {
                clearTimeout(expiry);
                update(null);
            }
            if (event.type === 'state') {
                if (event.state === 'stopped') {
                    stopSpectrum();
                    if (spectrumView) { spectrumStatus.textContent = 'Audio stopped · press Play to show the spectrum'; drawSpectrum(); }
                } else if (spectrumView) startSpectrum();
            }
        });
        window.addEventListener('pagehide', () => { clearTimeout(expiry); stopSpectrum(); unsubscribe?.(); }, { once: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
