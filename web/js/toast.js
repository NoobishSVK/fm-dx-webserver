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
            <div class="toast-title">${toastTitle}</div>
            <div class="toast-message">${message}</div>
          </div>
          <button class="close-btn">&nbsp;</button>
        </div>
      `);      

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
