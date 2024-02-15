var map;
var pin;
var tilesURL=' https://tile.openstreetmap.org/{z}/{x}/{y}.png';
var mapAttrib='&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// add map container

$(document).ready(function() {
  MapCreate();
  fetchData();
  
  
  map.on('click', function(ev) {
    $('#lat').val((ev.latlng.lat).toFixed(6));
    $('#lng').val((ev.latlng.lng).toFixed(6));
    
    if (typeof pin == "object") {
      pin.setLatLng(ev.latlng);
    } else {
      pin = L.marker(ev.latlng,{ riseOnHover:true,draggable:true });
      pin.addTo(map);
      pin.on('drag',function(ev) {
        $('#lat').val((ev.latlng.lat).toFixed(6));
        $('#lng').val((ev.latlng.lng).toFixed(6));
      });
    }
  });
  
  $('#login-form').submit(function (event) {
    event.preventDefault();
    
    // Perform an AJAX request to the /login endpoint
    $.ajax({
      type: 'POST',
      url: './login',
      data: $(this).serialize(),
      success: function (data) {
        // Update the content on the page with the message from the response
        $('#login-message').text(data.message);
        setTimeout(function () {
          location.reload(true);
        }, 1750);
      },
      error: function (xhr, status, error) {
        // Handle error response
        if (xhr.status === 403) {
          // Update the content on the page with the message from the error response
          $('#login-message').text(xhr.responseJSON.message);
        } else {
          // Handle other types of errors if needed
          console.error('Error:', status, error);
        }
      }
    });
  });    
  
  // Assuming you have an anchor tag with id 'logout-link'
  $('.logout-link').click(function (event) {
    event.preventDefault();
    
    // Perform an AJAX request to the /logout endpoint
    $.ajax({
      type: 'GET',  // Assuming the logout is a GET request, adjust accordingly
      url: './logout',
      success: function (data) {
        // Update the content on the page with the message from the response
        $('#login-message').text(data.message);
        setTimeout(function () {
          location.reload(true);
        }, 1750);
      },
      error: function (xhr, status, error) {
        // Handle error response
        if (xhr.status === 403) {
          // Update the content on the page with the message from the error response
          $('#login-message').text(xhr.responseJSON.message);
        } else {
          // Handle other types of errors if needed
          console.error('Error:', status, error);
        }
      }
    });
  });
  
  function stripAnsi(str) {
    return str.replace(/\u001b\[\d+m/g, '');
  }
  
  $("pre").html(function(_, html) {
    html = stripAnsi(html);
    return html.replace(/\[(\d{2}:\d{2})\]|\[(INFO|DEBUG|WARN|ERROR)\]/g, function(match, time, level) {
      if (time) {
        return "<span style='color: gray;'>" + match + "</span>";
      } else if (level === "INFO") {
        return "<span style='color: lime;'>" + match + "</span>";
      } else if (level === "DEBUG") {
        return "<span style='color: cyan;'>" + match + "</span>";
      } else if (level === "WARN") {
        return "<span style='color: yellow;'>" + match + "</span>";
      } else if (level === "ERROR") {
        return "<span style='color: red;'>" + match + "</span>";
      } else {
        return "<span style='color: white;'>" + match + "</span>";
      }
    });
  });
  
  $("#console-output").scrollTop($("#console-output")[0].scrollHeight);
});

function MapCreate() {
  // create map instance
  if (!(typeof map == "object")) {
    map = L.map('map', {
      center: [40,0],
      zoom: 3
    });
  }
  else {
    map.setZoom(3).panTo([40,0]);
  }
  // create the tile layer with correct attribution
  L.tileLayer(tilesURL, {
    attribution: mapAttrib,
    maxZoom: 19
  }).addTo(map);
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
        $('#audio-port').val(data.webserver.audioPort);

        $('#xdrd-ip').val(data.xdrd.xdrdIp);
        $('#xdrd-port').val(data.xdrd.xdrdPort);
        $('#xdrd-password').val(data.xdrd.xdrdPassword);

        $('#audio-devices').val(data.audio.audioDevice);
        $('#audio-channels').val(data.audio.audioChannels);
        $('#audio-quality').val(data.audio.audioBitrate);

        $('#webserver-name').val(data.identification.tunerName);
        $('#webserver-desc').val(data.identification.tunerDesc);
        $('#lat').val(data.identification.lat);
        $('#lng').val(data.identification.lon);
        $("#broadcast-tuner").prop("checked", data.identification.broadcastTuner);
        $("#broadcast-address").val(data.identification.proxyIp);

        $('#tune-pass').val(data.password.tunePass);
        $('#admin-pass').val(data.password.adminPass);

        $("#tuner-public").prop("checked", data.publicTuner);
        $("#tuner-lock").prop("checked", data.lockToAdmin);
        $("#shutdown-tuner").prop("checked", data.autoShutdown);

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


function submitData() {
    const webserverIp = $('#webserver-ip').val() || '0.0.0.0';
    const webserverPort = $('#webserver-port').val() || '8080';
    const audioPort = $('#audio-port').val() || '8081';

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
    const lat = $('#lat').val();
    const lon = $('#lng').val();
    const broadcastTuner = $("#broadcast-tuner").is(":checked");
    const proxyIp = $("#broadcast-address").val();

    const tunePass = $('#tune-pass').val();
    const adminPass = $('#admin-pass').val();

    const publicTuner = $("#tuner-public").is(":checked");
    const lockToAdmin = $("#tuner-lock").is(":checked");
    const autoShutdown = $("#shutdown-tuner").is(":checked");
  
    const data = {
      webserver: {
        webserverIp,
        webserverPort,
        audioPort
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
        lat,
        lon,
        broadcastTuner,
        proxyIp
      },
      password: {
        tunePass,
        adminPass,
      },
      publicTuner, 
      lockToAdmin,
      autoShutdown
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


  