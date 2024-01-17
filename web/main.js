const hostParts = window.location.host.split(':');
const hostname = hostParts[0]; // Extract the hostname
const port = hostParts[1] || '8080'; // Extract the port or use a default (e.g., 8080)
const socketAddress = `ws://${hostname}:${port}/text`; // Use 'wss' for secure WebSocket connections (recommended for external access)
const socket = new WebSocket(socketAddress);

const dataContainer = document.querySelector('#data-container');
const canvas = document.querySelector('#signal-canvas');
const context = canvas.getContext('2d');

var signalToggle = document.getElementById("signal-units-toggle");

canvas.width = canvas.parentElement.clientWidth;

const data = [];
const maxDataPoints = 250;
const pointWidth = (canvas.width - 80) / maxDataPoints;

var europe_programmes = [
    "No PTY", "News", "Current Affairs", "Info",
    "Sport", "Education", "Drama", "Culture", "Science", "Varied",
    "Pop M", "Rock M", "Easy Listening", "Light Classical",
    "Serious Classical", "Other Music", "Weather", "Finance",
    "Children's Programmes", "Social Affairs", "Religion", "Phone-in",
    "Travel", "Leisure", "Jazz Music", "Country Music", "National Music",
    "Oldies Music", "Folk Music", "Documentary", "Alarm Test"
];

// Function to handle zoom in
function zoomIn() {
    zoomMinValue *= 0.9;
    zoomMaxValue *= 0.9;
}

// Function to handle zoom out
function zoomOut() {
    zoomMinValue *= 1.1;
    zoomMaxValue *= 1.1;
}

function updateCanvas() {
    // Remove old data when it exceeds the maximum data points

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
        
        const offset = signalToggle.checked ? 11.75 : 0;
        context.textAlign = 'right';
        context.fillText(`${(zoomMinValue - offset).toFixed(1)}`, 35, lowestY - 14);
        context.fillText(`${(zoomMaxValue - offset).toFixed(1)}`, 35, highestY + 14);
        context.fillText(`${(zoomAvgValue - offset).toFixed(1)}`, 35, avgY - 3);

        context.textAlign = 'left';
        context.fillText(`${(zoomMinValue - offset).toFixed(1)}`, canvas.width - 35, lowestY - 14);
        context.fillText(`${(zoomMaxValue - offset).toFixed(1)}`, canvas.width - 35, highestY + 14);
        context.fillText(`${(zoomAvgValue - offset).toFixed(1)}`, canvas.width - 35, avgY - 3);
        
        // Update the data container with the latest data
        dataContainer.innerHTML = event.data + '<br>';
    };
    
    requestAnimationFrame(updateCanvas);
}

// Start updating the canvas
updateCanvas();

function compareNumbers(a, b) {
  return a - b;
}

function divideByHundred(a) {
    a = a / 100;
}

function updatePanels(parsedData) {
    sortedAf = parsedData.af.sort(compareNumbers);
    
    sortedAf.forEach((element, index, array) => {
        array[index] = element / 1000;

        // Check if it's the last element in the array
        if (index === array.length - 1) {
            document.querySelector('#data-af').innerHTML = array;
        }
    });

    document.querySelector('#data-frequency').textContent = parsedData.freq;
    document.querySelector('#data-pi').innerHTML = parsedData.pi === '?' ? "<span class='text-gray'>?</span>" : parsedData.pi;
    document.querySelector('#data-ps').innerHTML = parsedData.ps === '?' ? "<span class='text-gray'>?</span>" : parsedData.ps;
    document.querySelector('#data-tp').innerHTML = parsedData.tp === false ? "<span class='text-gray'>TP</span>" : "TP";
    document.querySelector('#data-pty').innerHTML = europe_programmes[parsedData.pty];
    document.querySelector('#data-st').innerHTML = parsedData.st === false ? "<span class='text-gray'>ST</span>" : "ST";
    document.querySelector('#data-rt0').innerHTML = parsedData.rt0;
    document.querySelector('#data-rt1').innerHTML = parsedData.rt1;
    document.querySelector('#data-signal').textContent = signalToggle.checked ? (parsedData.signal - 11.75).toFixed(1) : parsedData.signal;
}       

signalToggle.addEventListener("change", function() {
    signalText = document.querySelector('#signal-units');
    if (signalToggle.checked) {
        signalText.textContent = 'dBµV';
    } else {
        // Checkbox is unchecked
        signalText.textContent = 'dBf';
    }
});

const textInput = document.getElementById('commandinput');

textInput.addEventListener('keyup', function (event) {
    // Get the current input value
    let inputValue = textInput.value;

    // Remove non-digit characters
    inputValue = inputValue.replace(/[^0-9]/g, '');

    console.log("InputValue contains dot: ", inputValue.toLowerCase().includes("."));
    
    // Determine where to add the dot based on the frequency range
    if (inputValue.includes(".") === false) {
        if (inputValue.startsWith('10') && inputValue.length > 2) {
            // For frequencies starting with '10', add the dot after the third digit
            inputValue = inputValue.slice(0, 3) + '.' + inputValue.slice(3);
            textInput.value = inputValue;
        } else if (inputValue.length > 2) {
            // For other frequencies, add the dot after the second digit
            inputValue = inputValue.slice(0, 2) + '.' + inputValue.slice(2);
            textInput.value = inputValue;
        }
    }

    // Update the input value

    // Check if the pressed key is 'Enter' (key code 13)
    if (event.key === 'Enter') {
        // Retrieve the input value
        const inputValue = textInput.value;

        // Send the input value to the WebSocket
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(inputValue);
        }

        // Clear the input field if needed
        textInput.value = '';
    }
});

document.onkeydown = checkKey;

function checkKey(e) {
    e = e || window.event;
    currentFreq = document.getElementById("data-frequency").textContent;
    currentFreq = parseFloat(currentFreq).toFixed(3);
    currentFreq = parseFloat(currentFreq);

    if (socket.readyState === WebSocket.OPEN) {
        if (e.keyCode == '38') {
                socket.send((currentFreq + 0.01).toFixed(3));
            }
        else if (e.keyCode == '40') {
                socket.send((currentFreq - 0.01).toFixed(3));
        }
        else if (e.keyCode == '37') {
                socket.send((currentFreq - 0.10).toFixed(3));
        }
        else if (e.keyCode == '39') {
            socket.send((currentFreq + 0.10).toFixed(3));
        }
    }
}