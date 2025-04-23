// WebSocket connection located in ./websocket.js



var parsedData, signalChart, previousFreq;
var data = [];
var signalData = [];
let updateCounter = 0;
let messageCounter = 0; // Count for WebSocket data length returning 0
let messageData = 800; // Initial value anything above 0
let messageLength = 800; // Retain value of messageData until value is updated
let pingTimeLimit = false; // WebSocket becomes unresponsive with high ping

const europe_programmes = [
    "No PTY", "News", "Current Affairs", "Info",
    "Sport", "Education", "Drama", "Culture", "Science", "Varied",
    "Pop Music", "Rock Music", "Easy Listening", "Light Classical",
    "Serious Classical", "Other Music", "Weather", "Finance",
    "Children's Programmes", "Social Affairs", "Religion", "Phone-in",
    "Travel", "Leisure", "Jazz Music", "Country Music", "National Music",
    "Oldies Music", "Folk Music", "Documentary", "Alarm Test", "Alarm"
];

const usa_programmes = [
    "No PTY", "News", "Information", "Sports", "Talk", "Rock", "Classic Rock",
    "Adults Hits", "Soft Rock", "Top 40", "Country", "Oldies", "Soft Music",
    "Nostalgia", "Jazz", "Classical", "Rhythm and Blues", "Soft Rhythm and Blues", 
    "Language", "Religious Music", "Religious Talk", "Personality", "Public", "College",
    "Spanish Talk", "Spanish Music", "Hip Hop", "", "", "Weather", "Emergency Test", "Emergency" 
];

const rdsMode = localStorage.getItem('rdsMode');

$(document).ready(function () {
    const signalToggle = $("#signal-units-toggle");
    
    var $panel = $('.admin-quick-dashboard');
    var panelWidth = $panel.outerWidth();
    
    $(document).mousemove(function(e) {
        var mouseX = e.pageX;
        var panelLeft = parseInt($panel.css('left'));
        
        if (mouseX <= 10 || (panelLeft === 4 && mouseX <= 100)) {
            $panel.css('left', '4px');
        } else {
            $panel.css('left', -panelWidth);
        }
    });

    fillPresets();
    
    signalToggle.on("change", function () {
        const signalText = localStorage.getItem('signalUnit');
        
        if (signalText == 'dbuv') {
            signalText.text('dBµV');
        } else if (signalText == 'dbf') {
            signalText.text('dBf');
        } else {
            signalText.text('dBm');
        }
    });
    
    // Check if device is an iPhone to prevent zoom on button press
    if (/iPhone|iPod|iPad/.test(navigator.userAgent) && !window.MSStream) {
        const buttons = document.querySelectorAll('button');
        buttons.forEach(button => {
            button.addEventListener('touchstart', function(e) {
                // Prevent default zoom behavior
                e.preventDefault();
                // Allow default button action after short delay
                setTimeout(() => {
                    e.target.click();
                }, 0);
            });
        });
    }
    
    const textInput = $('#commandinput');
    
    textInput.on('change blur', function (event) {
        const inputValue = Number(textInput.val());
        // Check if the user agent contains 'iPhone'
        if (/iPhone/i.test(navigator.userAgent)) {
            socket.send("T" + (Math.round(inputValue * 1000)));
            // Clear the input field if needed
            textInput.val('');
        }
    });
    
    textInput.on('keyup', function (event) {
        
        if (event.key !== 'Backspace' && localStorage.getItem('extendedFreqRange') != "true") {
            let inputValue = textInput.val();
            inputValue = inputValue.replace(/[^0-9.]/g, '');
            
            if (inputValue.includes("..")) {
                inputValue = inputValue.slice(0, inputValue.lastIndexOf('.')) + inputValue.slice(inputValue.lastIndexOf('.') + 1);
                textInput.val(inputValue);
            }
            
            if (!inputValue.includes(".")) {
                if (inputValue.startsWith('10') && inputValue.length > 2) {
                    inputValue = inputValue.slice(0, 3) + '.' + inputValue.slice(3);
                    textInput.val(inputValue);
                } else if (inputValue.length > 2) {
                    inputValue = inputValue.slice(0, 2) + '.' + inputValue.slice(2);
                    textInput.val(inputValue);
                }
            }
        }
        if (event.key === 'Enter') {
            const inputValue = textInput.val();
            if (socket.readyState === WebSocket.OPEN) {
                socket.send("T" + (Math.round(inputValue * 1000)));
            }
            textInput.val('');
        }
    });
    
    document.onkeydown = function(event) {
        if (!event.repeat) {
            checkKey(event);
        }
    };
    
    
    let lastExecutionTime = 0;
    const throttleDelay = 100; // Time in ms
    $('#freq-container').on('wheel keypress', function (e) {
        e.preventDefault();
        const now = Date.now();
        
        if (now - lastExecutionTime < throttleDelay) {
            // Ignore this event as it's within the throttle delay
            return;
        }
        
        lastExecutionTime = now; // Update the last execution time
        
        getCurrentFreq();
        var delta = e.originalEvent.deltaY;
        var adjustment = 0;
        
        if (e.shiftKey) {
            adjustment = e.altKey ? 1 : 0.01;
        } else if (e.ctrlKey) {
            adjustment = 1;
        } else {
            if (delta > 0) {
                tuneDown();
            } else {
                tuneUp();
            }
            return false;
        }
        
        var newFreq = currentFreq + (delta > 0 ? -adjustment : adjustment);
        socket.send("T" + (Math.round(newFreq * 1000)));
        return false;
    });
    
    setInterval(getServerTime, 10000);
    getServerTime();
    setInterval(sendPingRequest, 5000);
    sendPingRequest();
    
    $("#tuner-name").click(function() {
        showTunerDescription();
    });
    
    var freqUpButton = $('#freq-up')[0];
    var freqDownButton = $('#freq-down')[0];
    var psContainer = $('#ps-container')[0];
    var rtContainer = $('#rt-container')[0];
    var piCodeContainer = $('#pi-code-container')[0];
    var freqContainer = $('#freq-container')[0];
    var txContainer = $('#data-station-container')[0];
    
    $("#data-eq").click(function () {
        toggleButtonState("eq");
    });
    
    $("#data-ims").click(function () {
        toggleButtonState("ims");
    });
    
    $("#volumeSlider").on('mouseup', function() {
        $('#volumeSlider').blur();
    })
    
    $(freqUpButton).on("click", tuneUp);
    $(freqDownButton).on("click", tuneDown);
    $(psContainer).on("click", copyPs);
    $(rtContainer).on("click", copyRt);
    $(txContainer).on("click", copyTx);
    $(piCodeContainer).on("click", findOnMaps);
    $(document).on("click", ".stereo-container", toggleForcedStereo);
    $(freqContainer).on("click", function () {
        textInput.focus();
    });
    
    //FMLIST logging
    $('.popup-content').on('click', function(event) {
        event.stopPropagation();
        $('.popup-content').removeClass('show');
    });
    
    $('#log-fmlist').on('click', function() {
        const logKey = 'fmlistLogChoice'; 
        const logTimestampKey = 'fmlistLogTimestamp'; 
        const expirationTime = 10 * 60 * 1000; 
        const now = Date.now();
        
        const storedChoice = localStorage.getItem(logKey);
        const storedTimestamp = localStorage.getItem(logTimestampKey);
        
        if (storedChoice && storedTimestamp && (now - storedTimestamp < expirationTime)) {
            sendLog(storedChoice); 
            return;
        }
        
        if (parsedData.txInfo.dist > 700) {
            $('#log-fmlist .popup-content').addClass('show'); // Show popup if no valid choice
            
            $('#log-fmlist-sporadice').off('click').on('click', function () {
                localStorage.setItem(logKey, './log_fmlist?type=sporadice');
                localStorage.setItem(logTimestampKey, now);
                if(parsedData.txInfo.dist > 700) sendLog('./log_fmlist?type=sporadice');
                $('#log-fmlist .popup-content').removeClass('show');
            });
            
            $('#log-fmlist-tropo').off('click').on('click', function () {
                localStorage.setItem(logKey, './log_fmlist?type=tropo');
                localStorage.setItem(logTimestampKey, now);
                if(parsedData.txInfo.dist > 700) sendLog('./log_fmlist?type=tropo');
                $('#log-fmlist .popup-content').removeClass('show');
            });
        } else {
            sendLog('./log_fmlist'); 
        }
        
        function sendLog(endpoint) {
            $.ajax({
                url: endpoint,
                method: 'GET',
                success: function(response) {
                    sendToast('success', 'Log successful', response, false, true);
                },
                error: function(xhr) {
                    let errorMessage;
                    
                    switch (xhr.status) {
                        case 429:
                        errorMessage = xhr.responseText;
                        break;
                        case 500:
                        errorMessage = 'Server error: ' + (xhr.responseText || 'Internal Server Error');
                        break;
                        default:
                        errorMessage = xhr.statusText || 'An error occurred';
                    }
                    
                    sendToast('error', 'Log failed', errorMessage, false, true);
                }
            });
        }
    });

    initCanvas();
    initTooltips();
});

function getServerTime() {
    $.ajax({
        url: "./server_time",
        dataType: "json",
        success: function(data) {
            const serverTimeUtc = data.serverTime;
            
            const options = {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            };
            
            const serverOptions = {
                ...options,
                timeZone: 'Etc/UTC'
            };
            
            const formattedServerTime = new Date(serverTimeUtc).toLocaleString(navigator.language ? navigator.language : 'en-US', serverOptions);
            
            $("#server-time").text(formattedServerTime);        
        },
        error: function(jqXHR, textStatus, errorThrown) {
            console.error("Error fetching server time:", errorThrown);
        }
    });
}  

function sendPingRequest() {
    const timeoutDuration = 5000;
    const startTime = new Date().getTime();
    
    const fetchWithTimeout = (url, options, timeout = timeoutDuration) => {
        return new Promise((resolve, reject) => {
            const timerTimeout = setTimeout(() => {
                reject(new Error('Request timed out'));
            }, timeout);
            
            fetch(url, options)
            .then(response => {
                clearTimeout(timerTimeout);
                resolve(response);
            })
            .catch(error => {
                clearTimeout(timerTimeout);
                reject(error);
            });
        });
    };
    
    fetchWithTimeout('./ping', { cache: 'no-store' }, timeoutDuration)
    .then(response => {
        const endTime = new Date().getTime();
        const pingTime = endTime - startTime;
        $('#current-ping').text(`Ping: ${pingTime}ms`);
        pingTimeLimit = false;
    })
    .catch(error => {
        console.warn('Ping request failed');
        $('#current-ping').text(`Ping: unknown`);
        if (!pingTimeLimit) { // Force reconnection as WebSocket could be unresponsive even though it's reported as OPEN
            if (messageLength === 0) window.socket.close(1000, 'Normal closure');
            if (connectionLost) sendToast('warning', 'Connection lost', 'Attempting to reconnect...', false, false);
            console.log("Reconnecting due to high ping...");
            pingTimeLimit = true;
        }
    });
    
    function handleMessage(message) {
        messageData = JSON.parse(message.data.length);
        socket.removeEventListener('message', handleMessage);
    }
    socket.addEventListener('message', handleMessage);
    messageLength = messageData;
    messageData = 0;
    
    // Force reconnection if no WebSocket data after several queries
    if (messageLength === 0) {
        messageCounter++;
        if (messageCounter === 5) {
            messageCounter = 0;
            window.socket.close(1000, 'Normal closure');
            if (connectionLost) sendToast('warning', 'Connection lost', 'Attempting to reconnect...', false, false);
            console.log("Reconnecting due to no data received...");
        }
    } else {
        messageCounter = 0;
    }
    
    // Automatic reconnection on WebSocket close
    if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        socket = new WebSocket(socketAddress);
        
        socket.onopen = () => {
            sendToast('info', 'Connected', 'Reconnected successfully!', false, false);
        };
        socket.onmessage = (event) => {
            handleWebSocketMessage(event);
        };
        socket.onerror = (error) => {
            console.error("Main/UI WebSocket error during reconnection:", error);
        };
        socket.onclose = () => {
            console.warn("Main/UI WebSocket closed during reconnection. Will attempt to reconnect...");
        };
    }
    if (connectionLost) {
        if (dataTimeout == dataTimeoutPrevious) {
            connectionLost = true;
        } else {
            setTimeout(() => {
                window.socket.close(1000, 'Normal closure'); // Force reconnection to unfreeze browser UI
            }, 8000); // Timeout must be higher than TIMEOUT_DURATION
            connectionLost = false;
            requiresAudioStreamRestart = true;
            console.log("Radio data restored.");
        }
    }
}

function handleWebSocketMessage(event) {
    if (event.data == 'KICK') {
        console.log('Kick initiated.')
        setTimeout(() => {
            window.location.href = '/403';
        }, 500);
        return;
    }
    
    parsedData = JSON.parse(event.data);
    
    resetDataTimeout();
    updatePanels(parsedData);
    
    const sum = signalData.reduce((acc, strNum) => acc + parseFloat(strNum), 0);
    const averageSignal = sum / signalData.length;
    data.push(averageSignal);
}
// Attach the message handler
socket.onmessage = handleWebSocketMessage;

const signalBuffer = [];

function initCanvas() {
    const ctx = document.getElementById("signal-canvas").getContext("2d");

    window.signalChart = new Chart(ctx, {
        type: "line",
        data: {
            datasets: [{
                label: "Signal Strength",
                borderColor: () => getComputedStyle(document.documentElement).getPropertyValue("--color-4").trim(),
                borderWidth: 2,
                fill: {
                    target: 'start'
                },
                backgroundColor: () => getComputedStyle(document.documentElement).getPropertyValue("--color-1-transparent").trim(),
                tension: 0.6,
                data: []
            }]
        },
        options: {
            layout: {
                padding: {
                    left: -10,
                    right: -10,
                    bottom: -10
                },
            },
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            elements: {
                point: { radius: 0 },
            },
            scales: {
                x: {
                    type: "realtime",
                    ticks: { display: false },
                    border: { display: false },
                    grid: { display: false, borderWidth: 0, borderColor: "transparent" },
                    realtime: {
                        duration: 30000,
                        refresh: 75,
                        delay: 150,
                        frameRate: 30, // default is 30
                        onRefresh: (chart) => {
                            if (!chart?.data?.datasets || parsedData?.sig === undefined) return;
                            if ((isAndroid || isIOS || isIPadOS) && (document.hidden || !document.hasFocus())) return;

                            const sig = parsedData.sig;
                            signalBuffer.push(sig);
                            if (signalBuffer.length > 8) signalBuffer.shift();

                            const avgSignal = signalBuffer.reduce((sum, val) => sum + val, 0) / signalBuffer.length;

                            const dataset = chart.data.datasets[0].data;
                            dataset.push({ x: Date.now(), y: avgSignal });

                            if (dataset.length > 400) dataset.shift(); // duration / refresh
                        }
                    }
                },
                y: {
                    beginAtZero: false,
                    grace: 0.25,
                    border: { display: false },
                    ticks: { 
                        maxTicksLimit: 3, 
                        display: false // Hide default labels
                    },
                    grid: { 
                        display: false, // Hide default grid lines
                    },
                },
                y2: {
                    position: 'right', // Position on the right side
                    beginAtZero: false,
                    grace: 0.25,
                    border: { display: false },
                    ticks: { 
                        maxTicksLimit: 3, 
                        display: false // Hide default labels for the right axis
                    },
                    grid: { 
                        display: false, // No grid for right axis
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            }
        },
        plugins: [{
            id: 'customYAxisLabels',
            afterDraw: (chart) => {
                const { ctx, scales, chartArea } = chart;
                const yAxis = scales.y;
                const y2Axis = scales.y2;

                const gridLineColor = getComputedStyle(document.documentElement).getPropertyValue("--color-2-transparent").trim(); // Grid color using CSS variable
                const textColor = getComputedStyle(document.documentElement).getPropertyValue("--color-5").trim(); // Use the same color for text labels

                ctx.save();
                ctx.font = "12px Titillium Web";
                ctx.fillStyle = textColor;
                ctx.textAlign = "center";

                const leftX = yAxis.left + 20;
                const rightX = y2Axis.right - 20;

                const offset = 10;

                yAxis.ticks.forEach((tick, index) => {
                    const y = yAxis.getPixelForValue(tick.value);
                    var adjustedY = Math.max(yAxis.top + 13, Math.min(y, yAxis.bottom - 6));
                    const isMiddleTick = index === Math.floor(yAxis.ticks.length / 2);

                    let adjustedTickValue;
                    switch(localStorage.getItem("signalUnit")) {
                        case "dbuv": adjustedTickValue = tick.value - 11.25; break;
                        case "dbm": adjustedTickValue = tick.value - 120; break;
                        default: adjustedTickValue = tick.value; break;
                    }
                
                    if (isMiddleTick) { adjustedY += 3; }
                    ctx.textAlign = 'right';
                    ctx.fillText(adjustedTickValue.toFixed(1), leftX + 25, adjustedY); 

                    ctx.textAlign = 'left';
                    ctx.fillText(adjustedTickValue.toFixed(1), rightX - 25, adjustedY); // Right side
                });
                
                const gridLineWidth = 0.5; // Make the lines thinner to avoid overlapping text
                const adjustedGridTop = chartArea.top + offset;
                const adjustedGridBottom = chartArea.bottom - offset;
                const middleY = chartArea.top + chartArea.height / 2;
                const padding = 45; // 30px inward on both sides
                
                // Helper function to draw a horizontal line
                function drawGridLine(y) {
                    ctx.beginPath();
                    ctx.moveTo(chartArea.left + padding, y);
                    ctx.lineTo(chartArea.right - padding, y);
                    ctx.strokeStyle = gridLineColor;
                    ctx.lineWidth = gridLineWidth;
                    ctx.stroke();
                }
                
                // Draw the three horizontal grid lines
                drawGridLine(adjustedGridTop);
                drawGridLine(adjustedGridBottom);
                drawGridLine(middleY);
                
                ctx.restore();
            }
        }]
    });
}

function setRefreshRate(rate) {
    const rt = signalChart.options.scales.x.realtime;
    rt.refresh = rate;
    signalChart.update('none');
    console.log(`Graph refresh rate set to ${rate} ms`);
}

window.addEventListener("focus", () => {
    if (isAndroid || isIOS || isIPadOS) setRefreshRate(75);
});

window.addEventListener("blur", () => {
    if (isAndroid || isIOS || isIPadOS) setRefreshRate(3000);
});

let reconnectTimer = null;
let dataTimeout = null;
let dataTimeoutPrevious = null;
let connectionLost = false;
let requiresAudioStreamRestart = false;

const TIMEOUT_DURATION = 5000;  // 5 seconds timeout for lost connection

const resetDataTimeout = () => {
    clearTimeout(dataTimeout);
    dataTimeout = setTimeout(() => {
        sendToast('warning', 'Connection lost', 'Attempting to reconnect...', false, false);
        connectionLost = true;
        dataTimeoutPrevious = dataTimeout;
    }, TIMEOUT_DURATION);
};

socket.onmessage = (event) => {
    if (event.data === 'KICK') {
        console.log('Kick initiated.');
        setTimeout(() => {
            window.location.href = '/403';
        }, 500);
        return;
    }
    
    parsedData = JSON.parse(event.data);
    
    resetDataTimeout();
    updatePanels(parsedData);
    
    const sum = signalData.reduce((acc, strNum) => acc + parseFloat(strNum), 0);
    const averageSignal = sum / signalData.length;
    data.push(averageSignal);
};

function compareNumbers(a, b) {
    return a - b;
}

function escapeHTML(unsafeText) {
    let div = document.createElement('div');
    div.innerText = unsafeText;
    return div.innerHTML.replace(' ', '&nbsp;');
}

function processString(string, errors) {
    var output = '';
    const max_alpha = 70;
    const alpha_range = 50;
    const max_error = 10;
    errors = errors?.split(',');
    
    for (let i = 0; i < string.length; i++) {
        alpha = parseInt(errors[i]) * (alpha_range / (max_error + 1));
        if (alpha) {
            output += "<span style='opacity: " + (max_alpha - alpha) + "%'>" + escapeHTML(string[i]) + "</span>";
        } else {
            output += escapeHTML(string[i]);
        }
    }
    
    return output;
}

function checkKey(e) {
    e = e || window.event;
    
    if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
        return;
    }
    
    if ($('#password:focus').length > 0
    || $('#chat-send-message:focus').length > 0
    || $('#volumeSlider:focus').length > 0
    || $('#chat-nickname:focus').length > 0
    || $('.option:focus').length > 0) {
        return; 
    }
    
    getCurrentFreq();
    
    if (socket.readyState === WebSocket.OPEN) {
        switch (e.keyCode) {
            case 66: // Back to previous frequency
                tuneTo(previousFreq);
                break;
            case 82: // RDS Reset (R key)
                tuneTo(Number(currentFreq));
                break;
            case 83: // Screenshot (S key)
                break;
            case 38:
                socket.send("T" + (Math.round(currentFreq*1000) + ((currentFreq > 30) ? 10 : 1)));
                break;
            case 40:
                socket.send("T" + (Math.round(currentFreq*1000) - ((currentFreq > 30) ? 10 : 1)));
                break;
            case 37:
                tuneDown();
                break;
            case 39:
                tuneUp();
                break;
            case 46:
                let $dropdown = $("#data-ant");
                let $input = $dropdown.find("input");
                let $options = $dropdown.find("ul.options .option");
        
                if ($options.length === 0) return; // No antennas available
        
                // Find the currently selected antenna
                let currentText = $input.attr("placeholder").trim();
                let currentIndex = $options.index($options.filter(function () {
                    return $(this).text().trim() === currentText;
                }));
        
                // Cycle to the next option
                let nextIndex = (currentIndex + 1) % $options.length;
                let $nextOption = $options.eq(nextIndex);
        
                // Update UI
                $input.attr("placeholder", $nextOption.text());
                $input.data("value", $nextOption.data("value"));
        
                // Send socket message (e.g., "Z0", "Z1", ...)
                let socketMessage = "Z" + $nextOption.data("value");
                socket.send(socketMessage);
            break;
            case 112: // F1
                e.preventDefault();
                tuneTo(Number(localStorage.getItem('preset1')));
            break;
            case 113: // F2
                e.preventDefault();
                tuneTo(Number(localStorage.getItem('preset2')));
            break;
            case 114: // F3
                e.preventDefault();
                tuneTo(Number(localStorage.getItem('preset3')));
            break;
            case 115: // F4
                e.preventDefault();
                tuneTo(Number(localStorage.getItem('preset4')));
            break;
            default:
            // Handle default case if needed
            break;
        }
    }
}

async function copyPs() {
    var frequency = $('#data-frequency').text();
    var pi = $('#data-pi').text();
    var ps = $('#data-ps').text();
    var signal = $('#data-signal').text();
    var signalDecimal = $('#data-signal-decimal').text();
    var signalUnit = $('.signal-units').eq(0).text();
    
    try {
        await copyToClipboard(frequency + " - " + pi + " | " + ps + " [" + signal + signalDecimal + " " + signalUnit + "]");
    } catch (error) {
        console.error(error);
    }
}

async function copyTx() {
    const frequency = $('#data-frequency').text();
    const pi = $('#data-pi').text();
    const stationName = $('#data-station-name').text();
    const stationCity = $('#data-station-city').text();
    const stationItu = $('#data-station-itu').text();
    const stationDistance = $('#data-station-distance').text();
    const stationErp = $('#data-station-erp').text();
    
    try {
        await copyToClipboard(frequency + " - " + pi + " | " + stationName + " [" + stationCity + ", " + stationItu + "] - " + stationDistance + " | " + stationErp + " kW");
    } catch (error) {
        console.error(error);
    }
}

async function copyRt() {
    var rt0 = $('#data-rt0 span').text();
    var rt1 = $('#data-rt1 span').text();
    
    try {
        await copyToClipboard("[0] RT: " + rt0 + "\n[1] RT: " + rt1);
    } catch (error) {
        console.error(error);
    }
}

function copyToClipboard(textToCopy) {
    // Navigator clipboard api needs a secure context (https)
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textToCopy)
        .catch(function (err) {
            console.error('Error:', err);
        });
    } else {
        var textArea = $('<textarea></textarea>');
        textArea.val(textToCopy);
        textArea.css({
            'position': 'absolute',
            'left': '-999999px'
        });
        
        $('body').prepend(textArea);
        textArea.select();
        
        try {
            document.execCommand('copy');
        } catch (error) {
            console.error('Error:', error);
        } finally {
            textArea.remove();
        }
    }
}

function findOnMaps() {
    var frequency = parseFloat($('#data-frequency').text());
    var pi = $('#data-pi').text();
    var latitude = localStorage.getItem('qthLongitude');
    var longitude = localStorage.getItem('qthLatitude');
    
    frequency > 74 ? frequency = frequency.toFixed(1) : null;
    
    var url = `https://maps.fmdx.org/#qth=${longitude},${latitude}&freq=${frequency}&findPi=${pi}`;
    window.open(url, "_blank");
}


function updateSignalUnits(parsedData, averageSignal) {
    const signalUnit = localStorage.getItem('signalUnit');
    let currentSignal;
    let highestSignal = parsedData.sigTop;
    
    currentSignal = averageSignal
    let signalText = $('.signal-units');
    let signalValue;
    
    switch (signalUnit) {
        case 'dbuv':
        signalValue = currentSignal - 11.25;
        highestSignal = highestSignal - 11.25;
        signalText.text('dBµV');
        break;
        
        case 'dbm':
        signalValue = currentSignal - 120;
        highestSignal = highestSignal - 120;
        signalText.text('dBm');
        break;
        
        default:
        signalValue = currentSignal;
        signalText.text('dBf');
        break;
    }
    
    const formatted = (Math.round(signalValue * 10) / 10).toFixed(1);
    const [integerPart, decimalPart] = formatted.split('.');
    
    $('#data-signal-highest').text(Number(highestSignal).toFixed(1));
    $('#data-signal').text(integerPart);
    $('#data-signal-decimal').text('.' + decimalPart);
}

// Cache jQuery selectors outside of the update function
const $dataFrequency = $('#data-frequency');
const $commandInput = $("#commandinput");
const $dataPi = $('#data-pi');
const $dataPs = $('#data-ps');
const $dataSt = $('.data-st');
const $dataRt0 = $('#data-rt0 span');
const $dataRt1 = $('#data-rt1 span');
const $dataAntInput = $('#data-ant input');
const $dataBwInput = $('#data-bw input');
const $dataStationContainer = $('#data-station-container');
const $dataTp = $('.data-tp');
const $dataTa = $('.data-ta');
const $dataMs = $('.data-ms');
const $flagDesktopCointainer = $('#flags-container-desktop');
const $dataPty = $('.data-pty');

// Throttling function to limit the frequency of updates
function throttle(fn, wait) {
    let isThrottled = false, savedArgs, savedThis;
    
    function wrapper() {
        if (isThrottled) {
            savedArgs = arguments;
            savedThis = this;
            return;
        }
        
        fn.apply(this, arguments);
        isThrottled = true;
        
        setTimeout(function() {
            isThrottled = false;
            if (savedArgs) {
                wrapper.apply(savedThis, savedArgs);
                savedArgs = savedThis = null;
            }
        }, wait);
    }
    
    return wrapper;
}

function updateTextIfChanged($element, newText) {
    if ($element.text() !== newText) {
        $element.text(newText);
    }
}

function updateHtmlIfChanged($element, newHtml) {
    if ($element.html() !== newHtml) {
        $element.html(newHtml);
    }
}

// Main function to update data elements, optimized
const updateDataElements = throttle(function(parsedData) {
    updateTextIfChanged($dataFrequency, parsedData.freq);
    $commandInput.attr("aria-label", "Current frequency: " + parsedData.freq);
    updateHtmlIfChanged($dataPi, parsedData.pi === '?' ? "<span class='opacity-half'>?</span>" : parsedData.pi);
    
    if ($('#ps-underscores').is(':checked')) {
        parsedData.ps = parsedData.ps.replace(/\s/g, '_');
    }
    updateHtmlIfChanged($dataPs, parsedData.ps === '?' ? "<span class='opacity-half'>?</span>" : processString(parsedData.ps, parsedData.ps_errors));
    
    if(parsedData.st) {
        $dataSt.parent().removeClass('opacity-half');
    } else {
        $dataSt.parent().addClass('opacity-half');
    }
    
    if(parsedData.stForced) {
        if (!parsedData.st) {
            stereoColor = 'gray';
        } else {
            stereoColor = 'var(--color-4)';
        }
        $('.data-st.circle1').css('left', '4px');
        $('.data-st.circle2').css('display', 'none');
    } else {
        $('.data-st.circle1').css('left', '0px');
        $('.data-st.circle2').css('display', 'block');
    }
    
    updateHtmlIfChanged($dataRt0, processString(parsedData.rt0, parsedData.rt0_errors));
    updateHtmlIfChanged($dataRt1, processString(parsedData.rt1, parsedData.rt1_errors));
    
    updateTextIfChanged($dataPty, rdsMode == 'true' ? usa_programmes[parsedData.pty] : europe_programmes[parsedData.pty]);
    
    if (parsedData.rds === true) {
        $flagDesktopCointainer.css('background-color', 'var(--color-2-transparent)');
    } else {
        $flagDesktopCointainer.css('background-color', 'var(--color-1-transparent)');
    }
    
    $('.data-flag').html(`<i title="${parsedData.country_name}" class="flag-sm flag-sm-${parsedData.country_iso}"></i>`);
    $('.data-flag-big').html(`<i title="${parsedData.country_name}" class="flag-md flag-md-${parsedData.country_iso}"></i>`);
    
    $dataAntInput.val($('#data-ant li[data-value="' + parsedData.ant + '"]').text());
    
    if(parsedData.bw < 500) {
        $dataBwInput.val($('#data-bw li[data-value2="' + parsedData.bw + '"]').text());
    } else {
        $dataBwInput.val($('#data-bw li[data-value="' + parsedData.bw + '"]').text());
    }
    
    if (parsedData.txInfo.tx.length > 1) {
        updateTextIfChanged($('#data-station-name'), parsedData.txInfo.tx.replace(/%/g, '%25'));
        updateTextIfChanged($('#data-station-erp'), parsedData.txInfo.erp);
        updateTextIfChanged($('#data-station-city'), parsedData.txInfo.city);
        updateTextIfChanged($('#data-station-itu'), parsedData.txInfo.itu);
        updateTextIfChanged($('#data-station-pol'), parsedData.txInfo.pol);
        updateHtmlIfChanged($('#data-station-azimuth'), parsedData.txInfo.azi + '°');
        const txDistance = localStorage.getItem('imperialUnits') == "true" ? (Number(parsedData.txInfo.dist) * 0.621371192).toFixed(0) + " mi" : parsedData.txInfo.dist + " km";
        updateTextIfChanged($('#data-station-distance'), txDistance);
        $dataStationContainer.css('display', 'block');
    } else {
        $dataStationContainer.removeAttr('style');
    }
    
    if(parsedData.txInfo.tx.length > 1 && parsedData.txInfo.dist > 150 && parsedData.txInfo.dist < 4000) {
        $('#log-fmlist').removeAttr('disabled').removeClass('btn-disabled cursor-disabled');
    } else {
        $('#log-fmlist').attr('disabled', 'true').addClass('btn-disabled cursor-disabled');
    }
    updateHtmlIfChanged($('#data-regular-pi'), parsedData.txInfo.reg === true ? parsedData.txInfo.pi : '&nbsp;');
    
    if (updateCounter % 8 === 0) {
        $dataTp.html(parsedData.tp === 0 ? "<span class='opacity-half'>TP</span>" : "TP");
        $dataTa.html(parsedData.ta === 0 ? "<span class='opacity-half'>TA</span>" : "TA");
        $dataMs.html(parsedData.ms === 0
            ? "<span class='opacity-half'>M</span><span class='opacity-full'>S</span>"
            : (parsedData.ms === -1
                ? "<span class='opacity-half'>M</span><span class='opacity-half'>S</span>"
                : "<span class='opacity-full'>M</span><span class='opacity-half'>S</span>"
            )
        );
    }
    
    if (updateCounter % 30 === 0) {
        $dataPs.attr('aria-label', parsedData.ps);
        $dataRt0.attr('aria-label', parsedData.rt0);
        $dataRt1.attr('aria-label', parsedData.rt1);
        $('#users-online-container').attr("aria-label", "Online users: " + parsedData.users);
    }
}, 75); // Update at most once every 100 milliseconds

let isEventListenerAdded = false;

function updatePanels(parsedData) {
    updateCounter = (updateCounter % 10000) + 1; // Count to 10000 then reset back to 1
    
    signalData.push(parsedData.sig);
    if (signalData.length > 8) {
        signalData.shift(); // Remove the oldest element
    }
    const sum = signalData.reduce((acc, strNum) => acc + parseFloat(strNum), 0);
    const averageSignal = sum / signalData.length;
    
    const sortedAf = parsedData.af.sort(compareNumbers);
    const scaledArray = sortedAf.map(element => element / 1000);
    
    const listContainer = $('#af-list');
    const scrollTop = listContainer.scrollTop();
    let ul = listContainer.find('ul');
    
    if (!ul.length) {
        ul = $('<ul></ul>');
        listContainer.append(ul);
    }
    
    if (updateCounter % 3 === 0) {
        
        updateButtonState("data-eq", parsedData.eq);
        updateButtonState("data-ims", parsedData.ims);
        
        // Only update #af-list on every 3rd call
        ul.html('');
        const listItems = scaledArray.map(createListItem);
        ul.append(listItems);
        
        // Add the event listener only once
        if (!isEventListenerAdded) {
            ul.on('click', 'a', function () {
                const frequency = parseFloat($(this).text());
                tuneTo(frequency);
            });
            isEventListenerAdded = true;
        }
        
        listContainer.scrollTop(scrollTop);
    }
    
    updateDataElements(parsedData);
    updateSignalUnits(parsedData, averageSignal);
    $('.users-online').text(parsedData.users);
}

function createListItem(element) {
    return $('<li></li>').html(`<a>${element.toFixed(1)}</a>`)[0];
}

function updateButtonState(buttonId, value) {
    var button = $("#" + buttonId);
    if (value == 0) {
        button.hasClass("btn-disabled") ? null : button.addClass("btn-disabled");
        button.attr('aria-description', 'Off');
    } else {
        button.hasClass("btn-disabled") ? button.removeClass("btn-disabled") : null;
        button.attr('aria-description', 'On');
    }
}

function toggleButtonState(buttonId) {
    parsedData[buttonId] = 1 - parsedData[buttonId]; // Toggle between 0 and 1
    updateButtonState(buttonId, parsedData[buttonId]);
    var message = "G";
    message += parsedData.eq ? "1" : "0";
    message += parsedData.ims ? "1" : "0";
    socket.send(message);
}

function toggleForcedStereo() {
    var message = "B";
    message += parsedData.stForced = (parsedData.stForced == "1") ? "0" : "1";
    socket.send(message);
}

function toggleLock(buttonSelector, activeMessage, inactiveMessage, activeLabel, inactiveLabel) {
    let $lockButton = $(buttonSelector);
    
    if ($lockButton.hasClass('active')) {
        socket.send(inactiveMessage);
        $lockButton.attr('aria-label', inactiveLabel);
        $lockButton.removeClass('active');
    } else {
        socket.send(activeMessage);
        $lockButton.attr('aria-label', activeLabel);
        $lockButton.addClass('active');
    }
}

function showTunerDescription() {
    let parentDiv = $("#tuner-name").parent();
    
    if (!$("#dashboard-panel-description").is(":visible")) {
        parentDiv.css("border-radius", "15px 15px 0 0");
    }
    
    $("#dashboard-panel-description").slideToggle(300, function() {
        if (!$(this).is(":visible")) {
            parentDiv.css("border-radius", "");
        }
    });
    
    $("#tuner-name i").toggleClass("rotated");

    if ($(window).width() < 768) {
        $('.dashboard-panel-plugin-list').slideToggle(300);
        $('#users-online-container').slideToggle(300);
        $('.chatbutton').slideToggle(300);
        $('#settings').slideToggle(300);
    }
}

function initTooltips(target = null) {
    // Define scope: all tooltips or specific one if target is provided
    const tooltips = target ? $(target) : $('.tooltip');
    
    // Unbind existing event handlers before rebinding to avoid duplication
    tooltips.off('mouseenter mouseleave');
    
    tooltips.hover(function () {
        if ($(this).closest('.popup-content').length) {
            return;
        }
        
        var tooltipText = $(this).data('tooltip');
        var placement = $(this).data('tooltip-placement') || 'top'; // Default to 'top'
        
        // Clear existing timeouts
        $(this).data('timeout', setTimeout(() => {
            $('.tooltip-wrapper').remove();
            
            var tooltip = $(`
                <div class="tooltip-wrapper">
                    <div class="tooltiptext">${tooltipText}</div>
                </div>
            `);
                $('body').append(tooltip);
                
                var tooltipEl = $('.tooltiptext');
                var tooltipWidth = tooltipEl.outerWidth();
                var tooltipHeight = tooltipEl.outerHeight();
                var targetEl = $(this);
                var targetOffset = targetEl.offset();
                var targetWidth = targetEl.outerWidth();
                var targetHeight = targetEl.outerHeight();
                
                // Compute position
                var posX, posY;
                switch (placement) {
                    case 'bottom':
                    posX = targetOffset.left + targetWidth / 2 - tooltipWidth / 2;
                    posY = targetOffset.top + targetHeight + 10;
                    break;
                    case 'left':
                    posX = targetOffset.left - tooltipWidth - 10;
                    posY = targetOffset.top + targetHeight / 2 - tooltipHeight / 2;
                    break;
                    case 'right':
                    posX = targetOffset.left + targetWidth + 10;
                    posY = targetOffset.top + targetHeight / 2 - tooltipHeight / 2;
                    break;
                    case 'top':
                    default:
                    posX = targetOffset.left + targetWidth / 2 - tooltipWidth / 2;
                    posY = targetOffset.top - tooltipHeight - 10;
                    break;
                }
                
                // Apply positioning
                tooltipEl.css({ top: posY, left: posX, opacity: 1 });

                // For touchscreen devices
                if ((/Mobi|Android|iPhone|iPad|iPod|Opera Mini/i.test(navigator.userAgent)) && ('ontouchstart' in window || navigator.maxTouchPoints)) {
                    setTimeout(() => { $('.tooltiptext').remove(); }, 5000);
                }
                
            }, 300));
        }, function () {
            clearTimeout($(this).data('timeout'));
            
            setTimeout(() => {
                $('.tooltip-wrapper').fadeOut(300, function () {
                    $(this).remove(); 
                });
            }, 100); 
        });
        
        $('.popup-content').off('mouseenter').on('mouseenter', function () {
            clearTimeout($('.tooltip').data('timeout'));
            $('.tooltip-wrapper').fadeOut(300, function () {
                $(this).remove(); 
            });
        });
    }
    
    function fillPresets() {
        let hasAnyPreset = false;
    
        for (let i = 1; i <= 4; i++) {
            let presetText = localStorage.getItem(`preset${i}`);
    
            if (presetText != "null") {
                hasAnyPreset = true;
                $(`#preset${i}-text`).text(presetText);
                $(`#preset${i}`).click(function() {
                    tuneTo(Number(presetText));
                });
            } else {
                $(`#preset${i}`).hide();
            }
        }
    
        if (!hasAnyPreset) {
            $('#preset1').parent().hide();
        }
    }
    