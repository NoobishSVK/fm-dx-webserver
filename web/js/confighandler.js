let configData = {};  // Store the original data structure globally

$(document).ready(function() {
  fetchConfig();
});

function submitConfig() {
  updateConfigData(configData);
  if ($("#password-adminPass").val().length < 1) {
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
    
    if (key === "plugins" && Array.isArray(value)) {
      const $options = $element.find('option');
      $options.each(function() {
        const dataName = $(this).data('name');
        if (value.includes(dataName)) {
          $(this).prop('selected', true);
        }
      });
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

    if (key === "plugins") {
      data[key] = [];
      const $selectedOptions = $element.find('option:selected');
      $selectedOptions.each(function() {
        const dataName = $(this).data('name');
        if (dataName) {
          data[key].push(dataName);
        }
      });
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
