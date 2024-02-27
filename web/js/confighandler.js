function submitData() {
    const webserverIp = $('#webserver-ip').val() || '0.0.0.0';
    const webserverPort = $('#webserver-port').val() || '8080';

    const xdrdIp = $('#xdrd-ip').val() || '127.0.0.1';
    const xdrdPort = $('#xdrd-port').val() || '7373';
    const xdrdPassword = $('#xdrd-password').val() || 'password';

    const audioDevice = $('#audio-devices').val() || 'Microphone (High Definition Audio Device)';
    const audioChannels = ($('.options .option').filter(function() {
      return $(this).text() === $('#audio-channels').val();
    }).data('value') || 2);
    const audioBitrate = ($('.options .option').filter(function() {
      return $(this).text() === $('#audio-quality').val();
    }).data('value') || "192k");

    const tunerName = $('#webserver-name').val() || 'FM Tuner';
    const tunerDesc = $('#webserver-desc').val() || 'Default FM tuner description';
    const broadcastTuner = $("#broadcast-tuner").is(":checked");
    const contact = $("#owner-contact").val() || '';
    const lat = $('#lat').val();
    const lon = $('#lng').val();
    const proxyIp = $("#broadcast-address").val();

    const tunePass = $('#tune-pass').val();
    const adminPass = $('#admin-pass').val();

    const publicTuner = $("#tuner-public").is(":checked");
    const lockToAdmin = $("#tuner-lock").is(":checked");
    const autoShutdown = $("#shutdown-tuner").is(":checked") || false;
    const antennaSwitch = $("#antenna-switch").is(":checked") || false;
  
    const data = {
      webserver: {
        webserverIp,
        webserverPort,
      },
      xdrd: {
        xdrdIp,
        xdrdPort,
        xdrdPassword
      },
      audio: {
        audioDevice, 
        audioChannels,
        audioBitrate, 
      },
      identification: {
        tunerName,
        tunerDesc,
        broadcastTuner,
        contact,
        lat,
        lon,
        proxyIp
      },
      password: {
        tunePass,
        adminPass,
      },
      publicTuner, 
      lockToAdmin,
      autoShutdown,
      antennaSwitch,
    };

    if(adminPass.length < 1) {
        alert('You need to fill in the admin password before continuing further.');
        return;
    }
    // Send data to the server using jQuery
    $.ajax({
      url: './saveData',
      type: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(data),
      success: function (message) {
        alert(message);
      },
      error: function (error) {
        console.error(error);
      }
    });
  }


  function fetchData() {
    // Make a GET request to retrieve the data.json file
    fetch("./getData")
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        $('#webserver-ip').val(data.webserver.webserverIp);
        $('#webserver-port').val(data.webserver.webserverPort);

        $('#xdrd-ip').val(data.xdrd.xdrdIp);
        $('#xdrd-port').val(data.xdrd.xdrdPort);
        $('#xdrd-password').val(data.xdrd.xdrdPassword);

        $('#audio-devices').val(data.audio.audioDevice);
        $('#audio-channels').val(data.audio.audioChannels);
        $('#audio-quality').val(data.audio.audioBitrate);

        $('#webserver-name').val(data.identification.tunerName);
        $('#webserver-desc').val(data.identification.tunerDesc);
        $("#broadcast-tuner").prop("checked", data.identification.broadcastTuner);
        $("#broadcast-address").val(data.identification.proxyIp);
        $("#owner-contact").val(data.identification.contact);
        $('#lat').val(data.identification.lat);
        $('#lng').val(data.identification.lon);

        $('#tune-pass').val(data.password.tunePass);
        $('#admin-pass').val(data.password.adminPass);

        $("#tuner-public").prop("checked", data.publicTuner);
        $("#tuner-lock").prop("checked", data.lockToAdmin);
        $("#shutdown-tuner").prop("checked", data.autoShutdown);
        $("#antenna-switch").prop("checked", data.antennaSwitch);

        // Check if latitude and longitude are present in the data
        if (data.identification.lat && data.identification.lon) {
          // Set the map's center to the received coordinates
          map.setView([data.identification.lat, data.identification.lon], 13);
          
          // Add a pin to the map
          if (typeof pin == "object") {
            pin.setLatLng([data.identification.lat, data.identification.lon]);
          } else {
            pin = L.marker([data.identification.lat, data.identification.lon], { riseOnHover:true, draggable:true });
            pin.addTo(map);
            pin.on('drag',function(ev) {
              $('#lat').val((ev.latlng.lat).toFixed(6));
              $('#lng').val((ev.latlng.lng).toFixed(6));
            });
          }
        }
      })
      .catch(error => {
        console.error('Error fetching data:', error.message);
      });
}
