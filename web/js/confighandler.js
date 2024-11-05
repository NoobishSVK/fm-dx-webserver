let configData = {};  // Store the original data structure globally

$(document).ready(function() {
  fetchConfig();
});

function submitConfig() {
  updateConfigData(configData);
  if (!configData.password || !configData.password.adminPass) {
    alert('You need to fill in the admin password before continuing further.');
    return;
  }

  $.ajax({
    url: './saveData',
    type: 'POST',
    contentType: 'application/json',
    data: JSON.stringify(configData),
    success: function (message) {
      sendToast('success', 'Data saved!', message, true, true);
    },
    error: function (error) {
      console.error(error);
    }
  });
}

function fetchConfig() {
  $.getJSON("./getData")
    .done(data => {
      configData = data; 
      populateFields(configData);
      initVolumeSlider();
      initConnectionToggle();
    })
    .fail(error => console.error("Error fetching data:", error.message));
}

function populateFields(data, prefix = "") {
  $.each(data, (key, value) => {

    if (key === "presets" && Array.isArray(value)) {
      value.forEach((item, index) => {
        const presetId = `${prefix}${prefix ? "-" : ""}${key}-${index + 1}`;
        const $element = $(`#${presetId}`);

        if ($element.length) {
          $element.val(item);
        }
      });
      return;
    }

    if (key === "banlist" && Array.isArray(value)) {
      const $textarea = $(`#${prefix}${prefix ? "-" : ""}${key}`);
      if ($textarea.length && $textarea.is("textarea")) {
        $textarea.val(value.join("\n"));
      }
      return;
    }

    const id = `${prefix}${prefix ? "-" : ""}${key}`;
    const $element = $(`#${id}`);

    if (typeof value === "object" && !Array.isArray(value)) {
      populateFields(value, id); 
      return;
    }

    if (!$element.length) {
      console.log(`Element with id ${id} not found`);
      return;
    }

    if (typeof value === "boolean") {
      $element.prop("checked", value);
    } else if ($element.is('input[type="text"]') && $element.closest('.dropdown').length) {
      const $dropdownOption = $element.siblings('ul.options').find(`li[data-value="${value}"]`);
      $element.val($dropdownOption.length ? $dropdownOption.text() : value);
      $element.attr('data-value', value);
    } else {
      $element.val(value);
    }
  });
}

function updateConfigData(data, prefix = "") {
  $.each(data, (key, value) => {
    const id = `${prefix}${prefix ? "-" : ""}${key}`;
    const $element = $(`#${id}`);

    if (key === "presets") {
      data[key] = [];
      let index = 1;
      while (true) {
        const $presetElement = $(`#${prefix}${prefix ? "-" : ""}${key}-${index}`);
        if ($presetElement.length) {
          data[key].push($presetElement.val());
          index++;
        } else {
          break;
        }
      }
      return;
    }

    if (key === "banlist") {
      const $textarea = $(`#${prefix}${prefix ? "-" : ""}${key}`);
      if ($textarea.length && $textarea.is("textarea")) {
        data[key] = $textarea.val().split("\n").filter(line => line.trim() !== ""); // Split lines into an array and filter out empty lines
      }
      return;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      return updateConfigData(value, id);
    }

    if ($element.length) {
      data[key] = typeof value === "boolean" ? $element.is(":checked") : $element.attr("data-value") ?? $element.val();
    }
  });
}