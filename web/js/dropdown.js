// Variables
const $dropdowns = $('.dropdown');
const $input = $('input');
const $listOfOptions = $('.option');
let currentDropdown = null; // Track the currently clicked dropdown

// Functions
const toggleDropdown = (event) => {
    event.stopPropagation();
    const $currentDropdown = $(event.currentTarget);
  
    // Close the previously opened dropdown if any
    $dropdowns.not($currentDropdown).removeClass('opened');
  
    $currentDropdown.toggleClass('opened');
    currentDropdown = $currentDropdown.hasClass('opened') ? $currentDropdown : null;
  };

const selectOption = (event) => {
  const $currentDropdown = currentDropdown;

  switch($currentDropdown.attr('id')) {
    case 'data-ant':
      socket.send("Z" + $(event.currentTarget).attr('data-value'));
      tuneTo(getCurrentFreq()); //Reset RDS when change antenna input
      break;
    case 'data-bw':
      if($(event.currentTarget).attr('data-value') > 500) { 
        socket.send("F" + $(event.currentTarget).attr('data-value'));
      } else {
        socket.send("W" + $(event.currentTarget).attr('data-value'));
      }

      $currentDropdown.find('input').val($(event.currentTarget).text());
      break;
    default:
      $currentDropdown.find('input').val($(event.currentTarget).text());
      break;
  }

  // Use setTimeout to delay class removal
  setTimeout(() => {
    $currentDropdown.removeClass('opened');
    currentDropdown = null;
  }, 10); // Adjust the delay as needed
};

const closeDropdownFromOutside = (event) => {
  const $currentDropdown = currentDropdown && $(currentDropdown);
  const isClickedInsideDropdown = $currentDropdown && $currentDropdown.has(event.target).length > 0;

  if (!isClickedInsideDropdown && $currentDropdown && $currentDropdown.hasClass('opened')) {
    $currentDropdown.removeClass('opened');
    currentDropdown = null;
  }
};

// Event Listeners
$(document).on('click', closeDropdownFromOutside);
$listOfOptions.on('click', selectOption);
$dropdowns.on('click', toggleDropdown);

// MULTISELECT
$('.multiselect option').mousedown(function(e) {
  e.preventDefault();
  var originalScrollTop = $(this).parent().scrollTop();
  console.log(originalScrollTop);
  $(this).prop('selected', $(this).prop('selected') ? false : true);
  var self = this;
  $(this).parent().focus();
  setTimeout(function() {
      $(self).parent().scrollTop(originalScrollTop);
  }, 0);
  
  return false;
});