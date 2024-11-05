var map;
var pin;
var tilesURL=' https://tile.openstreetmap.org/{z}/{x}/{y}.png';
var mapAttrib='&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>';

$(document).ready(function() {
  mapCreate();
  loadConsoleLogs();
  
  showPanelFromHash();
  initNav();
});

/**
 * Function to create & handle maps.
 * Also contains map handling such as reloading / pin click registering.
 */

function mapCreate() {
  if (!(typeof map == "object")) {
    map = L.map('map', {
      center: [40,0],
      zoom: 3
    });
  }
  else {
    map.setZoom(3).panTo([40,0]);
  }
  
  L.tileLayer(tilesURL, {
    attribution: mapAttrib,
    maxZoom: 19
  }).addTo(map);

  map.on('click', function(ev) {
    $('#identification-lat').val((ev.latlng.lat).toFixed(6));
    $('#identification-lon').val((ev.latlng.lng).toFixed(6));
    
    if (typeof pin == "object") {
      pin.setLatLng(ev.latlng);
    } else {
      pin = L.marker(ev.latlng,{ riseOnHover:true,draggable:true });
      pin.addTo(map);
      pin.on('dragend',function(ev) {
        $('#identification-lat').val((ev.latlng.lat).toFixed(6));
        $('#identification.lon').val((ev.latlng.lng).toFixed(6));
      });
    }
  });
  mapReload();
}

function mapReload() {
  setTimeout(function () {
    map.invalidateSize();
  }, 200);
}

function showPanelFromHash() {
  var panelId = window.location.hash.substring(1) || 'dashboard';
  
  $('.tab-content').hide();
  $('#' + panelId).show();
  
  $('.nav li').removeClass('active');
  $('.nav li[data-panel="' + panelId + '"]').addClass('active');
}

function initNav() {
  $('.nav li').click(function() {
    $('.nav li').removeClass('active');
    $(this).addClass('active');
    var panelId = $(this).data('panel');
    window.location.hash = panelId;
    $('.tab-content').hide();
    $('#' + panelId).show();
    
    panelId == 'identification' ? mapReload() : null;
  });

  $('[role="tab"]').on('keydown', function(event) {
    if (event.key === 'Enter') {
        $(this).find('a').click();
    }
  });
}

function toggleNav() {
  const navOpen = $("#navigation").css('margin-left') === '0px';
  const isMobile = window.innerWidth <= 768;
  
  if (navOpen) {
    if (isMobile) {
      // Do nothing to .admin-wrapper on mobile (since we're overlaying)
      $(".admin-wrapper").css({
        'margin-left': '0',
        'width': '100%' // Reset content to full width on close
      });
      $("#navigation").css('margin-left', 'calc(64px - 100vw)');
    } else {
      // On desktop, adjust the content margin and width
      $(".admin-wrapper").css({
        'margin-left': '64px',
        'width': 'calc(100% - 64px)'
      });
      $("#navigation").css('margin-left', '-356px');
    }
    $(".sidenav-close").html('<i class="fa-solid fa-chevron-right"></i>');
  } else {
    $("#navigation").css('margin-left', '0');
    if (isMobile) {
      $(".admin-wrapper").css({
        'margin-left': '0', // Keep content in place when sidenav is open
        'width': '100%' // Keep content at full width
      });
    } else {
      // On desktop, push the content
      $(".admin-wrapper").css({
        'margin-left': '420px',
        'width': 'calc(100% - 420px)'
      });
    }
    $(".sidenav-close").html('<i class="fa-solid fa-chevron-left"></i>');
  }
}

function initVolumeSlider() {
  const $volumeInput = $('#audio-startupVolume');
  const $percentageValue = $('#volume-percentage-value');
  
  const updateDisplay = () => {
    $percentageValue.text(($volumeInput.val() * 100).toFixed(0) + '%');
  };

  updateDisplay();
  $volumeInput.on('change', updateDisplay);
}

function initConnectionToggle() {
  const connectionToggle = $('#xdrd-wirelessConnection');
  const tunerUSB = $('#tuner-usb');
  const tunerWireless = $('#tuner-wireless');

  function toggleType() {
    if (connectionToggle.is(":checked")) {
      tunerUSB.hide();
      tunerWireless.show();
    } else {
      tunerWireless.hide();
      tunerUSB.show();
    }
  }

  toggleType();
  connectionToggle.change(toggleType);
}

function stripAnsi(str) {
  return str.replace(/\u001b\[\d+m/g, '');
}

async function loadConsoleLogs() {
  await new Promise((resolve) => {
    $("pre").html(function (_, html) {
      html = stripAnsi(html);

      const logColors = {
        INFO: "lime",
        DEBUG: "cyan",
        WARN: "yellow",
        ERROR: "red"
      };

      let firstBracketProcessed = false;

      const processedHtml = html.replace(/\[([^\]]+)\]/g, function (match, content) {
        if (!firstBracketProcessed) {
          firstBracketProcessed = true;
          return `<span style='color: gray;'>${match}</span>`;
        }

        const color = logColors[content] || "white";
        return `<span style='color: ${color};'>${match}</span>`;
      });

      return processedHtml;
    });
    resolve();
  });
  $("#console-output").scrollTop($("#console-output")[0].scrollHeight);
}
