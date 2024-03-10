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

  $('#dashboard').show();
  showPanelFromHash();
  $('.nav li').click(function() {
    // Remove background color from all li elements
    $('.nav li').removeClass('active');

    // Add background color to the clicked li element
    $(this).addClass('active');

    // Get the data-panel attribute value
    var panelId = $(this).data('panel');
    window.location.hash = panelId;
    // Hide all panels
    $('.tab-content').hide();
    
    // Show the corresponding panel
    $('#' + panelId).show();

    if(panelId == 'identification') {
        setTimeout(function () {
            map.invalidateSize();
        }, 200);
    }
  });

  $('#connection-type-toggle').change(function(){
    if($(this).is(":checked")) {
        $('#tuner-usb').hide();
        $('#tuner-wireless').show();
    } else {
        $('#tuner-wireless').hide();
        $('#tuner-usb').show();
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
  
  if($("#console-output").length > 0) {
    $("#console-output").scrollTop($("#console-output")[0].scrollHeight);
  }
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

  function showPanelFromHash() {
    var panelId = window.location.hash.substring(1);
    if (panelId) {
        // Hide all panels
        $('.tab-content').hide();
        
        // Show the panel corresponding to the hash fragment
        $('#' + panelId).show();
        
        // Remove active class from all li elements
        $('.nav li').removeClass('active');
        
        // Add active class to the corresponding li element
        $('.nav li[data-panel="' + panelId + '"]').addClass('active');
    }
}