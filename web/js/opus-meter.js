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
        panel.innerHTML = `<h2>Digital input</h2>
            <p class="meter-caption">Tuner input level · independent of playback volume</p>
            <div class="meter-channels"></div>
            <div class="meter-scale"><span>−90</span><span>−60</span><span>−30</span><span>0 dBFS</span></div>
            <p class="meter-caption meter-status">Start audio to show input levels</p>`;
        const style = document.createElement('style');
        style.textContent = `
            #peak-meter-container {box-sizing:border-box;padding:12px 20px;min-width:0;}
            #peak-meter-container h2 {font-size:20px;margin:0;}
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
        let rows = [], count = 0, lastReading = null;
        const position = db => db === null ? 0 : Math.max(0, Math.min(1, (db + 90) / 90));
        const value = db => db === null ? '−∞' : db.toFixed(1);
        function update() {
            const reading = window.fmdxAudio?.getInputLevels?.();
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
        const timer = setInterval(update, 100);
        window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
