function sendToast(type, title, message, persistent, important) {
    var toastId = 'toast-' + new Date().getTime(); // Unique ID for each toast

    // If title isn't provided, use the type as the title
    var toastTitle = title ? title : capitalizeFirstLetter(type);

    // Icon mapping based on the toast type
    var toastIcons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle',
        default: 'fa-bell' // Default icon if the type is not found
    };

    // Get the icon class based on the toast type, fallback to 'default' if type doesn't exist
    var iconClass = toastIcons[type] || toastIcons['default'];

    // Create the toast element
    var $toast = $(`
        <div class="toast ${type} flex-container ${important ? 'important' : ''}" id="${toastId}">
          <div class="toast-icon"><i class="fa-solid ${iconClass}"></i></div>
          <div>
            <div class="toast-title">${toastTitle}</div>
            <div class="toast-message">${message}</div>
          </div>
          <button class="close-btn">&nbsp;</button>
        </div>
      `);      

    // Append the toast to the container
    $('#toast-container').append($toast);

    // Add the 'show' class after appending for fade-in effect
    setTimeout(function () {
      $toast.addClass('show');
    }, 10); // Timeout to ensure the element is appended before the animation triggers

    // Close button functionality
    $toast.find('.close-btn').click(function () {
      closeToast($toast);
    });

    // If not persistent, remove it after 5 seconds
    if (!persistent) {
      setTimeout(function () {
        closeToast($toast);
      }, 5000); // 5000 ms = 5 seconds
    }
}

// Function to close and remove the toast
function closeToast($toast) {
    $toast.removeClass('show'); // Trigger fade-out
    setTimeout(function () {
        $toast.remove(); // Remove the element from DOM after the animation
    }, 300); // Timeout matches the CSS transition duration
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}
