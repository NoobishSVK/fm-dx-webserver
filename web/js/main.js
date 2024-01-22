$(document).ready(function() {
    var hostParts = window.location.host.split(':');
    var hostname = hostParts[0]; // Extract the hostname
    var port = hostParts[1] || '8080'; // Extract the port or use a default (e.g., 8080)
    var socketAddress = 'ws://' + hostname + ':' + port + '/text'; // Use 'wss' for secure WebSocket connections (recommended for external access)
    var socket = new WebSocket(socketAddress);
    
    var dataContainer = $('#data-container');
    var canvas = $('#signal-canvas')[0];
    var context = canvas.getContext('2d');
    
    var signalToggle = $("#signal-units-toggle");
    
    canvas.width = canvas.parentElement.clientWidth;
    
    var data = [];
    var maxDataPoints = 250;
    var pointWidth = (canvas.width - 80) / maxDataPoints;
    
    var europe_programmes = [
        "No PTY", "News", "Current Affairs", "Info",
        "Sport", "Education", "Drama", "Culture", "Science", "Varied",
        "Pop M", "Rock M", "Easy Listening", "Light Classical",
        "Serious Classical", "Other Music", "Weather", "Finance",
        "Children's Programmes", "Social Affairs", "Religion", "Phone-in",
        "Travel", "Leisure", "Jazz Music", "Country Music", "National Music",
        "Oldies Music", "Folk Music", "Documentary", "Alarm Test"
    ];
    
    function getInitialSettings() {
        $.ajax({
            url: '/static_data',
            dataType: 'json',
            success: function(data) {
                // Use the received data (data.qthLatitude, data.qthLongitude) as needed
                localStorage.setItem('qthLatitude', data.qthLatitude);
                localStorage.setItem('qthLongitude', data.qthLongitude);
                localStorage.setItem('webServerName', data.webServerName);
                
                document.title = 'FM-DX Webserver [' + data.webServerName + ']';
            },
            error: function(error) {
                console.error('Error:', error);
            }
        });
    }
    
    getInitialSettings();
    // Start updating the canvas
    updateCanvas();
    
    function updateCanvas() {
        const color2 = getComputedStyle(document.documentElement).getPropertyValue('--color-2').trim();
        const color4 = getComputedStyle(document.documentElement).getPropertyValue('--color-4').trim();
        
        while (data.length >= maxDataPoints) {
            data.shift();
        }
        
        // Modify the WebSocket onmessage callback
        socket.onmessage = (event) => {
            const parsedData = JSON.parse(event.data);
            
            updatePanels(parsedData);
            // Push the new signal data to the array
            data.push(parsedData.signal);
            const actualLowestValue = Math.min(...data);
            const actualHighestValue = Math.max(...data);
            zoomMinValue = actualLowestValue - ((actualHighestValue - actualLowestValue) / 2);
            zoomMaxValue = actualHighestValue + ((actualHighestValue - actualLowestValue) / 2);
            zoomAvgValue = (zoomMaxValue - zoomMinValue) / 2 + zoomMinValue;
            
            // Clear the canvas
            context.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw the signal graph with zoom
            context.beginPath();
            context.moveTo(50, canvas.height - (data[0] - zoomMinValue) * (canvas.height / (zoomMaxValue - zoomMinValue)));
            
            for (let i = 1; i < data.length; i++) {
                const x = i * pointWidth;
                const y = canvas.height - (data[i] - zoomMinValue) * (canvas.height / (zoomMaxValue - zoomMinValue));
                context.lineTo(x + 40, y);
            }
            
            context.strokeStyle = color4;
            context.lineWidth = 1;
            context.stroke();
            
            // Draw horizontal lines for lowest, highest, and average values
            context.strokeStyle = color2; // Set line color
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
            
            const offset = signalToggle.prop('checked') ? 11.75 : 0;
            context.textAlign = 'right';
            context.fillText(`${(zoomMinValue - offset).toFixed(1)}`, 35, lowestY - 14);
            context.fillText(`${(zoomMaxValue - offset).toFixed(1)}`, 35, highestY + 14);
            context.fillText(`${(zoomAvgValue - offset).toFixed(1)}`, 35, avgY - 3);
            
            context.textAlign = 'left';
            context.fillText(`${(zoomMinValue - offset).toFixed(1)}`, canvas.width - 35, lowestY - 14);
            context.fillText(`${(zoomMaxValue - offset).toFixed(1)}`, canvas.width - 35, highestY + 14);
            context.fillText(`${(zoomAvgValue - offset).toFixed(1)}`, canvas.width - 35, avgY - 3);
            
            // Update the data container with the latest data
            dataContainer.html(event.data + '<br>');
        };
        requestAnimationFrame(updateCanvas);
    }
    
    
    
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
    
    function updatePanels(parsedData) {
        const sortedAf = parsedData.af.sort(compareNumbers);
        const scaledArray = sortedAf.map(element => element / 1000);
        const listContainer = $('#af-list');
        const scrollTop = listContainer.scrollTop();
        let ul = listContainer.find('ul');
        
        if (!ul.length) {
            ul = $('<ul></ul>');
            listContainer.append(ul);
        }
        ul.html('');
        
        const listItems = scaledArray.map(element => {
            return $('<li></li>').text(element.toFixed(1))[0];
        });
        
        ul.append(listItems);
        listContainer.scrollTop(scrollTop);
        
        $('#data-frequency').text(parsedData.freq);
        $('#data-pi').html(parsedData.pi === '?' ? "<span class='text-gray'>?</span>" : parsedData.pi);
        $('#data-ps').html(parsedData.ps === '?' ? "<span class='text-gray'>?</span>" : processString(parsedData.ps, parsedData.ps_errors));
        $('#data-tp').html(parsedData.tp === false ? "<span class='text-gray'>TP</span>" : "TP");
        $('#data-pty').html(europe_programmes[parsedData.pty]);
        $('#data-st').html(parsedData.st === false ? "<span class='text-gray'>ST</span>" : "ST");
        $('#data-rt0').html(processString(parsedData.rt0, parsedData.rt0_errors));
        $('#data-rt1').html(processString(parsedData.rt1, parsedData.rt1_errors));
        $('#data-flag').html('<i title="' + parsedData.country_name + '" class="flag-sm flag-sm-' + parsedData.country_iso + '"></i>');
        
        const signalValue = signalToggle.is(':checked') ? (parsedData.signal - 11.75) : parsedData.signal;
        const integerPart = Math.floor(signalValue);
        const decimalPart = (signalValue - integerPart).toFixed(1).slice(1); // Adjusted this line
        
        $('#data-signal').text(integerPart);
        $('#data-signal-decimal').text(decimalPart);
        $('#users-online').text(parsedData.users);
    }
    
    signalToggle.on("change", function() {
        const signalText = $('#signal-units');
        if (signalToggle.prop('checked')) {
            signalText.text('dBµV');
        } else {
            signalText.text('dBf');
        }
    });    
    
    const textInput = $('#commandinput');
    
    textInput.on('change', function (event) {
        const inputValue = textInput.val();
        // Check if the user agent contains 'iPhone'
        if (/iPhone/i.test(navigator.userAgent) && socket.readyState === WebSocket.OPEN) {
            socket.send(inputValue);
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
                socket.send(inputValue);
            }
            textInput.val('');
        }
    });
    
    document.onkeydown = checkKey;
    
    function checkKey(e) {
        e = e || window.event;
        
        getCurrentFreq();
        
        if (socket.readyState === WebSocket.OPEN) {
            if (e.keyCode == '38') {
                socket.send((currentFreq + 0.01).toFixed(2));
            }
            else if (e.keyCode == '40') {
                socket.send((currentFreq - 0.01).toFixed(2));
            }
            else if (e.keyCode == '37') {
                socket.send((currentFreq - 0.10).toFixed(1));
            }
            else if (e.keyCode == '39') {
                socket.send((currentFreq + 0.10).toFixed(1));
            }
        }
    }
    
    function getCurrentFreq() {
        currentFreq = $('#data-frequency').text();
        currentFreq = parseFloat(currentFreq).toFixed(3);
        currentFreq = parseFloat(currentFreq);
        
        return currentFreq;
    }
    
    var freqUpButton = $('#freq-up')[0];
    var freqDownButton = $('#freq-down')[0];
    var psContainer = $('#ps-container')[0];
    var rtContainer = $('#rt-container')[0];
    var piCodeContainer = $('#pi-code-container')[0];
    var freqContainer = $('#freq-container')[0];
    
    $(freqUpButton).on("click", tuneUp);
    $(freqDownButton).on("click", tuneDown);
    $(psContainer).on("click", copyPs);
    $(rtContainer).on("click", copyRt);
    $(piCodeContainer).on("click", findOnMaps);
    $(freqContainer).on("click", function() {
        textInput.focus();
    });
    
    
    function tuneUp() {
        if (socket.readyState === WebSocket.OPEN) {
            getCurrentFreq();
            socket.send((currentFreq + 0.10).toFixed(1));
        }
    }
    
    function tuneDown() {
        if (socket.readyState === WebSocket.OPEN) {
            getCurrentFreq();
            socket.send((currentFreq - 0.10).toFixed(1));
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
    
    async function copyRt() {
        var rt0 = $('#data-rt0').text();
        var rt1 = $('#data-rt1').text();
        
        try {
            await copyToClipboard("[0] RT: " + rt0 + "\n[1] RT: " + rt1);
        } catch(error) {
            console.error(error);
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
});