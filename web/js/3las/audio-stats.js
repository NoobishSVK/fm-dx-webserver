(function () {
    function formatMs(value) {
        return Number.isFinite(value) ? Math.round(value) + " ms" : "Unavailable";
    }

    function setText(id, value) {
        var element = document.getElementById(id);
        if (element)
            element.textContent = value;
    }

    function updateAudioStats() {
        var panel = document.getElementById("audio-stream-stats");
        if (!panel)
            return;

        if (typeof Stream === "undefined" || !Stream || typeof Stream.GetStats !== "function") {
            panel.hidden = true;
            return;
        }

        var stats = Stream.GetStats();
        panel.hidden = false;

        var state = stats.Connected ? stats.AudioState : "connecting";
        setText("audio-stat-state", state.charAt(0).toUpperCase() + state.slice(1));
        setText("audio-stat-latency", stats.Connected ? formatMs(stats.LocalPlaybackLatencyMs) : "Waiting…");
        setText("audio-stat-buffer", stats.Connected ? formatMs(stats.ScheduledBufferMs) : "Waiting…");
        setText("audio-stat-pending", stats.Connected ? formatMs(stats.PendingDecodedMs) : "Waiting…");
        setText("audio-stat-buffer-target", formatMs(stats.TargetBufferMs));
        setText("audio-stat-output", formatMs(stats.BrowserOutputMs));
        setText("audio-stat-bitrate", stats.ReceiveRateKbps > 0 ? Math.round(stats.ReceiveRateKbps) + " kbit/s" : "Waiting…");

        var packetTiming = stats.PacketIntervalMs > 0
            ? Math.round(stats.PacketIntervalMs) + " / " + Math.round(stats.PacketJitterMs) + " ms"
            : "Waiting…";
        setText("audio-stat-packets", packetTiming);
        setText("audio-stat-last-packet", stats.LastPacketAgeMs === null ? "Waiting…" : formatMs(stats.LastPacketAgeMs) + " ago");
        setText("audio-stat-format", stats.Format + " · " + Math.round(stats.SampleRate / 1000) + " kHz");
        setText("audio-stat-recovery", stats.Underruns + " underruns · " + stats.SkippedBuffers + " skipped");
    }

    window.addEventListener("load", function () {
        updateAudioStats();
        window.setInterval(updateAudioStats, 1000);
    });
})();
