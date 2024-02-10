var url = new URL('text', window.location.href);
url.protocol = url.protocol.replace('http', 'ws');
var socketAddress = url.href;
var socket = new WebSocket(socketAddress);
var parsedData;
var data = [];
let signalChart;
    
const europe_programmes = [
    "No PTY", "News", "Current Affairs", "Info",
    "Sport", "Education", "Drama", "Culture", "Science", "Varied",
    "Pop M", "Rock M", "Easy Listening", "Light Classical",
    "Serious Classical", "Other Music", "Weather", "Finance",
    "Children's Programmes", "Social Affairs", "Religion", "Phone-in",
    "Travel", "Leisure", "Jazz Music", "Country Music", "National Music",
    "Oldies Music", "Folk Music", "Documentary", "Alarm Test"
];

$(document).ready(function() {
    var canvas = $('#signal-canvas')[0];
    
    var signalToggle = $("#signal-units-toggle");
    
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
    
    getInitialSettings();
    // Start updating the canvas
    initCanvas();
    
    signalToggle.on("change", function() {
        const signalText = localStorage.getItem('signalUnit');

        if (signalText == 'dbuv') {
            signalText.text('dBµV');
        } else if (signalText == 'dbf') {
            signalText.text('dBf');
        } else {
            signalText.text('dBm');
        }
    });    

    var input = $("#tuner-desc").text();
    var parsed = input;
    
    var grayTextRegex = /--(.*?)--/g;
    parsed = parsed.replace(grayTextRegex, '<span class="text-gray">$1</span>');
    
    var boldRegex = /\*\*(.*?)\*\*/g;
    parsed = parsed.replace(boldRegex, '<strong>$1</strong>');
    
    var italicRegex = /\*(.*?)\*/g;
    parsed = parsed.replace(italicRegex, '<em>$1</em>');

    var breakLineRegex = /\\n/g;
    parsed = parsed.replace(breakLineRegex, '<br>');
    
    $("#tuner-desc").html(parsed);
    
    const textInput = $('#commandinput');
    
    textInput.on('change', function (event) {
        const inputValue = textInput.val();
        // Check if the user agent contains 'iPhone'
        if (/iPhone/i.test(navigator.userAgent) && socket.readyState === WebSocket.OPEN) {
            socket.send("T" + (inputValue * 1000));
            // Clear the input field if needed
            textInput.val('');
        }
    });
    
    textInput.on('keyup', function (event) {
        if (event.key !== 'Backspace') {
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

    $('#freq-container').on('wheel', function(e) {
        var delta = e.originalEvent.deltaY;
            if (delta > 0) {
                tuneDown();
            } else {
                tuneUp();
            }
            return false;
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

    $(freqUpButton).on("click", tuneUp);
    $(freqDownButton).on("click", tuneDown);
    $(psContainer).on("click", copyPs);
    $(rtContainer).on("click", copyRt);
    $(txContainer).on("click", copyTx);
    $(piCodeContainer).on("click", findOnMaps);
    $(freqContainer).on("click", function() {
        textInput.focus();
    });
});

function getInitialSettings() {
    $.ajax({
        url: './static_data',
        dataType: 'json',
        success: function(data) {
            // Use the received data (data.qthLatitude, data.qthLongitude) as needed
            localStorage.setItem('qthLatitude', data.qthLatitude);
            localStorage.setItem('qthLongitude', data.qthLongitude);
            localStorage.setItem('audioPort', data.audioPort);
            localStorage.setItem('streamEnabled', data.streamEnabled);
        },
        error: function(error) {
            console.error('Error:', error);
        }
    });
}

function initCanvas(parsedData) {
    signalToggle = $("#signal-units-toggle");

    // Check if signalChart is already initialized
    if (!signalChart) {
        signalChart = {
            canvas: $('#signal-canvas')[0],
            context: $('#signal-canvas')[0].getContext('2d'),
            parsedData: parsedData,
            maxDataPoints: 300,
        }
        signalChart.pointWidth = (signalChart.canvas.width - 80) / signalChart.maxDataPoints;
    }

    updateCanvas(parsedData, signalChart);
}

function updateCanvas(parsedData, signalChart) {
    const color2 = getComputedStyle(document.documentElement).getPropertyValue('--color-2').trim();
    const color4 = getComputedStyle(document.documentElement).getPropertyValue('--color-4').trim();
    const {context, canvas, maxDataPoints, pointWidth} = signalChart;

    while (data.length >= signalChart.maxDataPoints) {
        data.shift();
    }

    const actualLowestValue = Math.min(...data);
    const actualHighestValue = Math.max(...data);
    zoomMinValue = actualLowestValue - ((actualHighestValue - actualLowestValue) / 2);
    zoomMaxValue = actualHighestValue + ((actualHighestValue - actualLowestValue) / 2);
    zoomAvgValue = (zoomMaxValue - zoomMinValue) / 2 + zoomMinValue;

    // Clear the canvas
    if(context) {
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Draw the signal graph with smooth shifting
        context.beginPath();
    }

    const startingIndex = Math.max(0, data.length - maxDataPoints);

    for (let i = startingIndex; i < data.length; i++) {
        const x = canvas.width - (data.length - i) * pointWidth - 40;
        const y = canvas.height - (data[i] - zoomMinValue) * (canvas.height / (zoomMaxValue - zoomMinValue));

        if (i === startingIndex) {
            context.moveTo(x, y);
        } else {
            const prevX = canvas.width - (data.length - i + 1) * pointWidth - 40;
            const prevY = canvas.height - (data[i - 1] - zoomMinValue) * (canvas.height / (zoomMaxValue - zoomMinValue));

            // Interpolate between the current and previous points
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

    const signalUnit = localStorage.getItem('signalUnit');
    let offset;

    if (signalUnit === 'dbuv') {
        offset = 11.25;
    } else if (signalUnit === 'dbm') {
        offset = 120;
    } else {
        offset = 0;
    }

    context.textAlign = 'right';
    context.fillText(`${(zoomMinValue - offset).toFixed(1)}`, 35, lowestY - 14);
    context.fillText(`${(zoomMaxValue - offset).toFixed(1)}`, 35, highestY + 14);
    context.fillText(`${(zoomAvgValue - offset).toFixed(1)}`, 35, avgY - 3);

    context.textAlign = 'left';
    context.fillText(`${(zoomMinValue - offset).toFixed(1)}`, canvas.width - 35, lowestY - 14);
    context.fillText(`${(zoomMaxValue - offset).toFixed(1)}`, canvas.width - 35, highestY + 14);
    context.fillText(`${(zoomAvgValue - offset).toFixed(1)}`, canvas.width - 35, avgY - 3);

    requestAnimationFrame(() => updateCanvas(parsedData, signalChart));
}

socket.onmessage = (event) => {
    parsedData = JSON.parse(event.data);
    updatePanels(parsedData);
    data.push(parsedData.signal);
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

    // Check if any input element is focused using jQuery
    if ($('input:focus').length > 0) {
        return; // Do nothing if an input is focused
    }

    getCurrentFreq();

    if (socket.readyState === WebSocket.OPEN) {
        switch (e.keyCode) {
            case 82: // RDS Reset (R key)
                socket.send("T" + (currentFreq.toFixed(1) * 1000));
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
            default:
                // Handle default case if needed
                break;
        }
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
    if (socket.readyState === WebSocket.OPEN) {
        socket.send("T" + ((freq).toFixed(1) * 1000));
    }
}

async function copyPs() {
    var frequency = $('#data-frequency').text();
    var pi = $('#data-pi').text();
    var ps = $('#data-ps').text();
    var signal = $('#data-signal').text();
    var signalDecimal = $('#data-signal-decimal').text();
    var signalUnit = $('#signal-units').text();
    
    try {
        await copyToClipboard(frequency + " - " + pi + " | " + ps +  " [" + signal + signalDecimal + " " + signalUnit + "]");
    } catch(error) {
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
        await copyToClipboard(frequency + " - " + pi + " | " + stationName +  " [" + stationCity + ", " + stationItu + "] - " + stationDistance + " km | " + stationErp + " kW");
    } catch(error) {
        console.error(error);
    }
}

async function copyRt() {
    var rt0 = $('#data-rt0').text();
    var rt1 = $('#data-rt1').text();
    
    try {
        await copyToClipboard("[0] RT: " + rt0 + "\n[1] RT: " + rt1);
    } catch(error) {
        console.error(error);
    }
}

function copyToClipboard(textToCopy) {
    // Navigator clipboard api needs a secure context (https)
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textToCopy)
        .catch(function(err) {
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
    var frequency = $('#data-frequency').text();
    var pi = $('#data-pi').text();
    var latitude = localStorage.getItem('qthLongitude');
    var longitude = localStorage.getItem('qthLatitude');
    frequency = parseFloat(frequency).toFixed(1);
    
    var url = "https://maps.fmdx.pl/#qth=" + longitude + "," + latitude + "&freq=" + frequency + "&pi=" + pi;
    window.open(url, "_blank");
}

function updateSignalUnits(parsedData) {
    const signalUnit = localStorage.getItem('signalUnit');
    let signalText = $('#signal-units');
    let signalValue;

    switch (signalUnit) {
        case 'dbuv':
            signalValue = parsedData.signal - 11.25;
            signalText.text('dBµV');
            break;

        case 'dbm':
            signalValue = parsedData.signal - 120;
            signalText.text('dBm');
            break;

        default:
            signalValue = parsedData.signal;
            signalText.text('dBf');
            break;
    }

    const formatted = (Math.round(signalValue * 10) / 10).toFixed(1);
    const [integerPart, decimalPart] = formatted.split('.');

    $('#data-signal').text(integerPart);
    $('#data-signal-decimal').text('.' + decimalPart);
}

function updateDataElements(parsedData) {
    $('#data-frequency').text(parsedData.freq);
    $("#commandinput").attr("aria-label", "Current frequency: " + parsedData.freq);
    $('#data-pi').html(parsedData.pi === '?' ? "<span class='opacity-half'>?</span>" : parsedData.pi);
    $('#data-ps').html(parsedData.ps === '?' ? "<span class='opacity-half'>?</span>" : processString(parsedData.ps, parsedData.ps_errors));
    $('.data-tp').html(parsedData.tp === false ? "<span class='opacity-half'>TP</span>" : "TP");
    $('.data-ta').html(parsedData.ta === 0 ? "<span class='opacity-half'>TA</span>" : "TA");
    $('.data-ms').html(parsedData.ms === 0
        ? "<span class='opacity-half'>M</span><span class='opacity-full'>S</span>"
        : (parsedData.ms === -1
            ? "<span class='opacity-half'>M</span><span class='opacity-half'>S</span>"
            : "<span class='opacity-full'>M</span><span class='opacity-half'>S</span>"
          )
    );        
    $('.data-pty').html(europe_programmes[parsedData.pty]);
    $('.data-st').html(parsedData.st === false ? "<span class='text-gray'>ST</span>" : "ST");
    $('#data-rt0').html(processString(parsedData.rt0, parsedData.rt0_errors));
    $('#data-rt1').html(processString(parsedData.rt1, parsedData.rt1_errors));
    $('.data-flag').html(`<i title="${parsedData.country_name}" class="flag-sm flag-sm-${parsedData.country_iso}"></i>`);
    $('#data-ant input').val($('#data-ant li[data-value="' + parsedData.ant + '"]').text());

    if(parsedData.txInfo.station.length > 1) {
        $('#data-station-name').text(decodeURIComponent(parsedData.txInfo.station.replace(/\u009e/g, '\u017E')));
        $('#data-station-erp').text(parsedData.txInfo.erp);
        $('#data-station-city').text(parsedData.txInfo.city);
        $('#data-station-itu').text(parsedData.txInfo.itu);
        $('#data-station-pol').text(parsedData.txInfo.pol);
        $('#data-station-distance').text(parsedData.txInfo.distance);
        $('#data-station-azimuth').text(parsedData.txInfo.azimuth);
        $('#data-station-container').css('display', 'block');
    } else {
        $('#data-station-container').removeAttr('style');
    }
}

let isEventListenerAdded = false;

let updateCounter = 0;

function updatePanels(parsedData) {
    updateCounter++;

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

    // Update other elements every time
    updateDataElements(parsedData);
    updateSignalUnits(parsedData);
    $('.users-online').text(parsedData.users);
}

function createListItem(element) {
    return $('<li></li>').html(`<a>${element.toFixed(1)}</a>`)[0];
}

function updateButtonState(buttonId, value) {
    var button = $("#" + buttonId);
    if (value === 0) {
        button.addClass("btn-disabled");
    } else {
        button.removeClass("btn-disabled");
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
