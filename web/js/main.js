var url = new URL('text', window.location.href);
url.protocol = url.protocol.replace('http', 'ws');
var socketAddress = url.href;
var socket = new WebSocket(socketAddress);
var parsedData, signalChart, previousFreq;
var signalData = [];
var data = [];
let updateCounter = 0;

const europe_programmes = [
    "No PTY", "News", "Current Affairs", "Info",
    "Sport", "Education", "Drama", "Culture", "Science", "Varied",
    "Pop M", "Rock M", "Easy Listening", "Light Classical",
    "Serious Classical", "Other Music", "Weather", "Finance",
    "Children's Programmes", "Social Affairs", "Religion", "Phone-in",
    "Travel", "Leisure", "Jazz Music", "Country Music", "National Music",
    "Oldies Music", "Folk Music", "Documentary", "Alarm Test"
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
    var canvas = $('#signal-canvas')[0];

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

    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;

    // Start updating the canvas
    initCanvas();
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

    const textInput = $('#commandinput');

    textInput.on('change', function (event) {
        const inputValue = Number(textInput.val());
        // Check if the user agent contains 'iPhone'
        if (/iPhone/i.test(navigator.userAgent)) {
            socket.send("T" + (inputValue * 1000));
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
                socket.send("T" + (inputValue * 1000));
            }
            textInput.val('');
        }
    });

    document.onkeydown = checkKey;

    $('#freq-container').on('wheel keypress', function (e) {
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
          timeZone: 'Etc/UTC' // Add timeZone only for server time
        };
  
        const formattedServerTime = new Date(serverTimeUtc).toLocaleString(navigator.language ? navigator.language : 'en-US', serverOptions);
        
        $("#server-time").text(formattedServerTime);        
  
        // Get and format user's local time directly without specifying timeZone:
        const localTime = new Date();
        const formattedLocalTime = new Date(localTime).toLocaleString(navigator.language ? navigator.language : 'en-US', options);
  
        // Display client time:
        $("#client-time").text(formattedLocalTime);
      },
      error: function(jqXHR, textStatus, errorThrown) {
        console.error("Error fetching server time:", errorThrown);
        // Handle error gracefully (e.g., display a fallback message)
      }
    });
  }  
  
function sendPingRequest() {
    const startTime = new Date().getTime();

    fetch('./ping')
        .then(response => {
            const endTime = new Date().getTime();
            const pingTime = endTime - startTime;
            $('#current-ping').text(`Ping: ${pingTime}ms`);
        })
        .catch(error => {
            console.error('Error fetching ping:', error);
        });
}

function initCanvas(parsedData) {
    signalToggle = $("#signal-units-toggle");

    // Check if signalChart is already initialized
    if (!signalChart) {
        const canvas = $('#signal-canvas')[0];
        const context = canvas.getContext('2d');
        const maxDataPoints = 300;
        const pointWidth = (canvas.width - 80) / maxDataPoints;
        

        signalChart = {
            canvas,
            context,
            parsedData,
            maxDataPoints,
            pointWidth,
            color2: null,
            color4: null,
            signalUnit: localStorage.getItem('signalUnit'),
            offset: 0,
        };

        switch(signalChart.signalUnit) {
            case 'dbuv': signalChart.offset = 11.25; break;
            case 'dbm': signalChart.offset = 120; break;
            default: signalChart.offset = 0;
        }
        // Initialize colors and signal unit
        updateChartSettings(signalChart);
        
        // Periodically check for color and signal unit updates
        setInterval(() => {
            updateChartSettings(signalChart);
        }, 1000); // Check every 1 second
    }

    updateCanvas(parsedData, signalChart);
}

function updateChartSettings(signalChart) {
    // Update colors
    const newColor2 = getComputedStyle(document.documentElement).getPropertyValue('--color-2').trim();
    const newColor4 = getComputedStyle(document.documentElement).getPropertyValue('--color-4').trim();
    if (newColor2 !== signalChart.color2 || newColor4 !== signalChart.color4) {
        signalChart.color2 = newColor2;
        signalChart.color4 = newColor4;
    }

    // Update signal unit
    const newSignalUnit = localStorage.getItem('signalUnit');
    if (newSignalUnit !== signalChart.signalUnit) {
        signalChart.signalUnit = newSignalUnit;
        // Adjust the offset based on the new signal unit
        switch(newSignalUnit) {
            case 'dbuv': signalChart.offset = 11.25; break;
            case 'dbm': signalChart.offset = 120; break;
            default: signalChart.offset = 0;
        }
    }
}

function updateCanvas(parsedData, signalChart) {
    const { context, canvas, maxDataPoints, pointWidth, color2, color4, offset } = signalChart;

    if (data.length > maxDataPoints) {
        data = data.slice(data.length - maxDataPoints);
    }

    const actualLowestValue = Math.min(...data);
    const actualHighestValue = Math.max(...data);
    const zoomMinValue = actualLowestValue - ((actualHighestValue - actualLowestValue) / 2);
    const zoomMaxValue = actualHighestValue + ((actualHighestValue - actualLowestValue) / 2);
    const zoomAvgValue = (zoomMaxValue - zoomMinValue) / 2 + zoomMinValue;

    // Clear the canvas
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.beginPath();

    const startingIndex = Math.max(0, data.length - maxDataPoints);

    for (let i = startingIndex; i < data.length; i++) {
        const x = canvas.width - (data.length - i) * pointWidth - 40;
        const y = canvas.height - (data[i] - zoomMinValue) * (canvas.height / (zoomMaxValue - zoomMinValue));

        if (i === startingIndex) {
            context.moveTo(x, y);
        } else {
            const prevX = canvas.width - (data.length - i + 1) * pointWidth - 40;
            const prevY = canvas.height - (data[i - 1] - zoomMinValue) * (canvas.height / (zoomMaxValue - zoomMinValue));
            const interpolatedX = (x + prevX) / 2;
            const interpolatedY = (y + prevY) / 2;

            context.quadraticCurveTo(prevX, prevY, interpolatedX, interpolatedY);
        }
    }

    context.strokeStyle = color4;
    context.lineWidth = 1;
    context.stroke();

    // Draw horizontal lines for lowest, highest, and average values
    context.strokeStyle = color2;
    context.lineWidth = 1;

    // Draw the lowest value line
    const lowestY = canvas.height - (zoomMinValue - zoomMinValue) * (canvas.height / (zoomMaxValue - zoomMinValue));
    context.beginPath();
    context.moveTo(40, lowestY - 18);
    context.lineTo(canvas.width - 40, lowestY - 18);
    context.stroke();

    // Draw the highest value line
    const highestY = canvas.height - (zoomMaxValue - zoomMinValue) * (canvas.height / (zoomMaxValue - zoomMinValue));
    context.beginPath();
    context.moveTo(40, highestY + 10);
    context.lineTo(canvas.width - 40, highestY + 10);
    context.stroke();

    const avgY = canvas.height / 2;
    context.beginPath();
    context.moveTo(40, avgY - 7);
    context.lineTo(canvas.width - 40, avgY - 7);
    context.stroke();

    // Label the lines with their values
    context.fillStyle = color4;
    context.font = '12px Titillium Web';

    context.textAlign = 'right';
    context.fillText(`${(zoomMinValue - offset).toFixed(1)}`, 35, lowestY - 14);
    context.fillText(`${(zoomMaxValue - offset).toFixed(1)}`, 35, highestY + 14);
    context.fillText(`${(zoomAvgValue - offset).toFixed(1)}`, 35, avgY - 3);

    context.textAlign = 'left';
    context.fillText(`${(zoomMinValue - offset).toFixed(1)}`, canvas.width - 35, lowestY - 14);
    context.fillText(`${(zoomMaxValue - offset).toFixed(1)}`, canvas.width - 35, highestY + 14);
    context.fillText(`${(zoomAvgValue - offset).toFixed(1)}`, canvas.width - 35, avgY - 3);

    setTimeout(() => {
        requestAnimationFrame(() => updateCanvas(parsedData, signalChart));
    }, 1000 / 15);
}

socket.onmessage = (event) => {
    if (event.data == 'KICK') {
        console.log('Kick iniitiated.')
        setTimeout(() => {
          window.location.href = '/403';
        }, 500);
        return;
    }

    parsedData = JSON.parse(event.data);

    updatePanels(parsedData);
    if(localStorage.getItem("smoothSignal") == 'true') {
        const sum = signalData.reduce((acc, strNum) => acc + parseFloat(strNum), 0);
        const averageSignal = sum / signalData.length;
        data.push(averageSignal);
    } else {
        data.push(parsedData.signal);
    }
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

function getCurrentFreq() {
    currentFreq = $('#data-frequency').text();
    currentFreq = parseFloat(currentFreq).toFixed(3);
    currentFreq = parseFloat(currentFreq);

    return currentFreq;
}

function checkKey(e) {
    e = e || window.event;

    if ($('#password:focus').length > 0
    || $('#chat-send-message:focus').length > 0
    || $('#volumeSlider:focus').length > 0
    || $('#chat-nickname:focus').length > 0) {
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
        previousFreq = currentFreq;
    }
}

function tuneUp() {
    if (socket.readyState === WebSocket.OPEN) {
        getCurrentFreq();
        let addVal = 0;
        if (currentFreq < 0.52) {
            addVal = 9 - (Math.round(currentFreq*1000) % 9);
        } else if (currentFreq < 1.71) {
            // TODO: Rework to replace 9 with 9 or 10 based on regionalisation setting
            addVal = 9 - (Math.round(currentFreq*1000) % 9);
        } else if (currentFreq < 29.6) {
            addVal = 5 - (Math.round(currentFreq*1000) % 5);
        } else if (currentFreq >= 65.9 && currentFreq < 74) {
            addVal = 30 - ((Math.round(currentFreq*1000) - 65900) % 30);
        } else {
            addVal = 100 - (Math.round(currentFreq*1000) % 100);
        }
        socket.send("T" + (Math.round(currentFreq*1000) + addVal));
    }
}

function tuneDown() {
    if (socket.readyState === WebSocket.OPEN) {
        getCurrentFreq();
        let subVal = 0;
        if (currentFreq < 0.52) {
            subVal = (Math.round(currentFreq*1000) % 9 == 0) ? 9 : (Math.round(currentFreq*1000) % 9);
        } else if (currentFreq < 1.71) {
            // TODO: Rework to replace 9 with 9 or 10 based on regionalisation setting
            subVal = (Math.round(currentFreq*1000) % 9 == 0) ? 9 : (Math.round(currentFreq*1000) % 9);
        } else if (currentFreq < 29.6) {
            subVal = (Math.round(currentFreq*1000) % 5 == 0) ? 5 : (Math.round(currentFreq*1000) % 5);
        } else if (currentFreq > 65.9 && currentFreq <= 74) {
            subVal = ((Math.round(currentFreq*1000) - 65900) % 30 == 0) ? 30 : ((Math.round(currentFreq*1000) - 65900) % 30);
        } else {
            subVal = (Math.round(currentFreq*1000) % 100 == 0) ? 100 : (Math.round(currentFreq*1000) % 100);
        }
        socket.send("T" + (Math.round(currentFreq*1000) - subVal));
    }
}

function tuneTo(freq) {
        socket.send("T" + ((freq).toFixed(1) * 1000));
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
        await copyToClipboard(frequency + " - " + pi + " | " + stationName + " [" + stationCity + ", " + stationItu + "] - " + stationDistance + " km | " + stationErp + " kW");
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
    var frequency = parseFloat($('#data-frequency').text()).toFixed(1);
    var pi = $('#data-pi').text();
    var latitude = localStorage.getItem('qthLongitude');
    var longitude = localStorage.getItem('qthLatitude');

    var url = `https://maps.fmdx.pl/#qth=${longitude},${latitude}&freq=${frequency}&findPi=${pi}`;
    window.open(url, "_blank");
}


function updateSignalUnits(parsedData, averageSignal) {
    const signalUnit = localStorage.getItem('signalUnit');
    let currentSignal;
    let highestSignal = parsedData.highestSignal;

    if(localStorage.getItem("smoothSignal") == 'true') {
        currentSignal = averageSignal
    } else {
        currentSignal = parsedData.signal;
    }
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

// Utility function to update element's text if changed
function updateTextIfChanged($element, newText) {
    if ($element.text() !== newText) {
        $element.text(newText);
    }
}

// Utility function to update element's HTML content if changed
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

    if (localStorage.getItem('psUnderscores') === 'true') {
        parsedData.ps = parsedData.ps.replace(/\s/g, '_');
    }
    updateHtmlIfChanged($dataPs, parsedData.ps === '?' ? "<span class='opacity-half'>?</span>" : processString(parsedData.ps, parsedData.ps_errors));

    updateHtmlIfChanged($dataSt, `<span class='opacity-${parsedData.st ? 'full' : 'half'}'>${parsedData.st_forced ? 'MO' : 'ST'}</span>`);

    updateHtmlIfChanged($dataRt0, processString(parsedData.rt0, parsedData.rt0_errors));
    updateHtmlIfChanged($dataRt1, processString(parsedData.rt1, parsedData.rt1_errors));

    updateTextIfChanged($dataPty, rdsMode == 'true' ? usa_programmes[parsedData.pty] : europe_programmes[parsedData.pty]);

    if (parsedData.rds === true) {
        $flagDesktopCointainer.css('background-color', 'var(--color-2)');
    } else {
        $flagDesktopCointainer.css('background-color', 'var(--color-1)');
    }

    $('.data-flag').html(`<i title="${parsedData.country_name}" class="flag-sm flag-sm-${parsedData.country_iso}"></i>`);
    $('.data-flag-big').html(`<i title="${parsedData.country_name}" class="flag-md flag-md-${parsedData.country_iso}"></i>`);

    $dataAntInput.val($('#data-ant li[data-value="' + parsedData.ant + '"]').text());
    $dataBwInput.val($('#data-bw li[data-value="' + parsedData.bw + '"]').text());

    if (parsedData.txInfo.station.length > 1) {
        updateTextIfChanged($('#data-station-name'), parsedData.txInfo.station.replace(/%/g, '%25'));
        updateTextIfChanged($('#data-station-erp'), parsedData.txInfo.erp);
        updateTextIfChanged($('#data-station-city'), parsedData.txInfo.city);
        updateTextIfChanged($('#data-station-itu'), parsedData.txInfo.itu);
        updateTextIfChanged($('#data-station-pol'), parsedData.txInfo.pol);
        updateTextIfChanged($('#data-station-distance'), parsedData.txInfo.distance);
        updateTextIfChanged($('#data-station-azimuth'), parsedData.txInfo.azimuth);
        $dataStationContainer.css('display', 'block');
    } else {
        $dataStationContainer.removeAttr('style');
    }

    updateCounter++;
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
}, 100); // Update at most once every 100 milliseconds

let isEventListenerAdded = false;

function updatePanels(parsedData) {
    updateCounter++;

    signalData.push(parsedData.signal);
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
    } else {
        button.hasClass("btn-disabled") ? button.removeClass("btn-disabled") : null;
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
    message += parsedData.st_forced = (parsedData.st_forced == "1") ? "0" : "1";
    socket.send(message);
}

function toggleAdminLock() {
    let $adminLockButton = $('#dashboard-lock-admin');

    if($adminLockButton.hasClass('active')) {
        socket.send('wL0');
        $adminLockButton.attr('aria-label', '"ock Tuner (Admin)')
        $adminLockButton.removeClass('active');
    } else {
        socket.send('wL1');
        $adminLockButton.attr('aria-label', 'Unlock Tuner (Admin)')
        $adminLockButton.addClass('active');
    }
}

function togglePasswordLock() {
    let $passwordLockButton = $('#dashboard-lock-tune');

    if($passwordLockButton.hasClass('active')) {
        socket.send('wT0');
        $passwordLockButton.removeClass('active');
        $passwordLockButton.attr('aria-label', 'Lock Tuner (Password tune)')
    } else {
        socket.send('wT1');
        $passwordLockButton.addClass('active');
        $passwordLockButton.attr('aria-label', 'Unlock Tuner (Password tune)')
    }
}

function initTooltips() {
    $('.tooltip').hover(function(e){
        var tooltipText = $(this).data('tooltip');
        
        // Add a delay of 500 milliseconds before creating and appending the tooltip
        $(this).data('timeout', setTimeout(() => {
            var tooltip = $('<div class="tooltiptext"></div>').html(tooltipText);
            $('body').append(tooltip);

            var posX = e.pageX;
            var posY = e.pageY;

            var tooltipWidth = tooltip.outerWidth();
            var tooltipHeight = tooltip.outerHeight();
            posX -= tooltipWidth / 2;
            posY -= tooltipHeight + 10;
            tooltip.css({ top: posY, left: posX, opacity: 1 }); // Set opacity to 1
        }, 500));
    }, function() {
        // Clear the timeout if the mouse leaves before the delay completes
        clearTimeout($(this).data('timeout'));
        $('.tooltiptext').remove();
    }).mousemove(function(e){
        var tooltipWidth = $('.tooltiptext').outerWidth();
        var tooltipHeight = $('.tooltiptext').outerHeight();
        var posX = e.pageX - tooltipWidth / 2;
        var posY = e.pageY - tooltipHeight - 10;

        $('.tooltiptext').css({ top: posY, left: posX });
    });
}

function fillPresets() {
    for (let i = 1; i <= 4; i++) {
        let presetText = localStorage.getItem(`preset${i}`);
        $(`#preset${i}`).text(presetText);
        $(`#preset${i}`).click(function() {
            tuneTo(Number(presetText));
        });
    }
}
