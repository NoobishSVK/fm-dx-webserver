function submitData() {
    const webserverIp = $('#webserver-ip').val() || '0.0.0.0';
    const webserverPort = $('#webserver-port').val() || '8080';
    const tuningLimit = $('#tuning-limit').is(":checked") || false;
    const tuningLowerLimit = $('#tuning-lower-limit').val() || '0';
    const tuningUpperLimit = $('#tuning-upper-limit').val() || '108';
    const chatEnabled = $("#chat-switch").length > 0 ? $("#chat-switch").is(":checked") : true;

    var themeSelectedValue = $("#selected-theme").val();
    var themeDataValue = $(".option:contains('" + themeSelectedValue + "')").attr('data-value') || 'theme1';
    const defaultTheme = themeDataValue;
    
    let presets = [];
    presets.push($('#preset1').val() || '87.5');
    presets.push($('#preset2').val() || '87.5');
    presets.push($('#preset3').val() || '87.5');
    presets.push($('#preset4').val() || '87.5');

    const enableDefaultFreq = $('#default-freq-enable').is(":checked") || false;
    const defaultFreq = $('#default-freq').val() || '87.5';

    let banlist = [];
    if($('#ip-addresses').length > 0) {
      validateAndAdd(banlist);
    }

    
    var comDevicesValue = $("#com-devices").val();
    var comDevicesDataValue = $(".option:contains('" + comDevicesValue + "')").attr('data-value') || '';
    const comPort = comDevicesDataValue;
    const wirelessConnection = $('#connection-type-toggle').is(":checked") || false;
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

    const device = ($('.options .option').filter(function() {
      return $(this).text() === $('#device-type').val();
    }).data('value') || "tef");

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
        tuningLimit,
        tuningLowerLimit,
        tuningUpperLimit,
        chatEnabled,
        defaultTheme,
        presets,
        banlist
      },
      xdrd: {
        comPort,
        wirelessConnection,
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
      device,
      publicTuner, 
      lockToAdmin,
      autoShutdown,
      antennaSwitch,
      enableDefaultFreq,
      defaultFreq,
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
        $('#tuning-limit').prop("checked", data.webserver.tuningLimit);
        $('#tuning-lower-limit').val(data.webserver.tuningLowerLimit || "");
        $('#tuning-upper-limit').val(data.webserver.tuningUpperLimit || "");
        $("#chat-switch").prop("checked", data.webserver.chatEnabled || false);

        $('#selected-theme').val(data.webserver.defaultTheme || 'Default');

        var selectedTheme = $(".option[data-value='" + data.webserver.defaultTheme + "']");
        
        // If the option exists, set its text as the value of the input
        if (selectedTheme.length > 0) {
            $("#selected-theme").val(selectedTheme.text());
        }
        
        if(Array.isArray(data.webserver.presets)) {
          $('#preset1').val(data.webserver.presets[0] || "");
          $('#preset2').val(data.webserver.presets[1] || "");
          $('#preset3').val(data.webserver.presets[2] || "");
          $('#preset4').val(data.webserver.presets[3] || "");
        }

        $("#default-freq-enable").prop("checked", data.enableDefaultFreq || false);
        $('#default-freq').val(data.defaultFreq || "87.5");

        $('#ip-addresses').val(data.webserver.banlist?.join('\n') || "");

        $('#connection-type-toggle').prop("checked", data.xdrd.wirelessConnection || false);
        
        if($('#connection-type-toggle').is(":checked")) {
          $('#tuner-usb').hide();
          $('#tuner-wireless').show();
        } else {
          $('#tuner-wireless').hide();
          $('#tuner-usb').show();
        }

        $('#xdrd-ip').val(data.xdrd.xdrdIp);
        $('#xdrd-port').val(data.xdrd.xdrdPort);
        $('#xdrd-password').val(data.xdrd.xdrdPassword);
        $('#com-devices').val(data.xdrd.comPort);
        var selectedDevice = $(".option[data-value='" + data.xdrd.comPort + "']");
        if (selectedDevice.length > 0) {
          $("#com-devices").val(selectedDevice.text());
        }

        $('#device-type').val(data.device);
        var selectedDevice = $(".option[data-value='" + data.device + "']");
        if (selectedDevice.length > 0) {
          $("#device-type").val(selectedDevice.text());
        }

        $('#audio-devices').val(data.audio.audioDevice);
        $('#audio-channels').val(data.audio.audioChannels);
        var selectedChannels = $(".option[data-value='" + data.audio.audioChannels + "']");
        if (selectedChannels.length > 0) {
          $("#audio-channels").val(selectedChannels.text());
        }
        $('#audio-quality').val(data.audio.audioBitrate);
        var selectedQuality = $(".option[data-value='" + data.audio.audioBitrate + "']");
        if (selectedQuality.length > 0) {
          $("#audio-quality").val(selectedQuality.text());
        }

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


function validateAndAdd(banlist) {
  var textarea = $('#ip-addresses');
  var ipAddresses = textarea.val().split('\n');

  // Regular expression to validate IP address
  var ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;

  ipAddresses.forEach(function(ip) {
      if (ipRegex.test(ip)) {
          banlist.push(ip);
      }
  });
}