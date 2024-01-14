    const audioElement = document.getElementById("myAudio");
    const volumeSlider = document.getElementById("volumeSlider");
    const audioStream = "/audio-proxy";
    const uniqueTimestamp = Date.now(); // Create a unique timestamp

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioSource = audioContext.createMediaElementSource(audioElement);

    audioSource.connect(audioContext.destination);

    // Set the audio element's source to your external audio stream
    audioElement.src = `${audioStream}?${uniqueTimestamp}`;


    audioElement.play();

    volumeSlider.addEventListener("input", (event) => {
        event.stopPropagation();
        audioElement.volume = volumeSlider.value;
    });