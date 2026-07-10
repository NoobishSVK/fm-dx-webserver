// Allow <br>, <strong>, <b>
function setToastText(el, text) {
    while (el.firstChild) el.removeChild(el.firstChild);

    var parts = String(text).split(/(<br\s*\/?>|<\/?strong>|<\/?b>)/gi);
    var stack = [el];

    parts.forEach(function (part) {
        var tag = part.toLowerCase().replace(/\s+/g, '');

        if (tag === '<br>' || tag === '<br/>') {
            stack[stack.length - 1].appendChild(document.createElement('br'));
        } else if (tag === '<strong>') {
            var strongEl = document.createElement('strong');
            stack[stack.length - 1].appendChild(strongEl);
            stack.push(strongEl);
        } else if (tag === '</strong>') {
            if (stack.length > 1) stack.pop();
        } else if (tag === '<b>') {
            var bEl = document.createElement('b');
            stack[stack.length - 1].appendChild(bEl);
            stack.push(bEl);
        } else if (tag === '</b>') {
            if (stack.length > 1) stack.pop();
        } else if (part) {
            stack[stack.length - 1].appendChild(document.createTextNode(part));
        }
    });
}

function sendToast(type, title, message, persistent, important) {
    var toastId = 'toast-' + new Date().getTime();

    var toastTitle = title ? title : capitalizeFirstLetter(type);

    var toastIcons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle',
        default: 'fa-bell'
    };

    var iconClass = toastIcons[type] || toastIcons['default']; // Get the icon class based on the toast type, fallback to 'default' if type doesn't exist

    var $toast = $(`
        <div class="toast ${type} flex-container flex-phone ${important ? 'important' : ''}" id="${toastId}">
          <div class="toast-icon"><i class="fa-solid ${iconClass}"></i></div>
          <div>
            <div class="toast-title"></div>
            <div class="toast-message"></div>
          </div>
          <button class="close-btn">&nbsp;</button>
        </div>
      `);

    setToastText($toast.find('.toast-title')[0], toastTitle);
    setToastText($toast.find('.toast-message')[0], message);

    $('#toast-container').append($toast);

    setTimeout(function () {
      $toast.addClass('show');
    }, 10);

    $toast.find('.close-btn').click(function () {
      closeToast($toast);
    });

    if (!persistent) {
      setTimeout(function () {
        closeToast($toast);
      }, 5000);
    }
}

function closeToast($toast) {
    $toast.removeClass('show');
    setTimeout(function () {
        $toast.remove();
    }, 300);
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}
