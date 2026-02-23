$(document).ready(function() {
    // Variables
    const $dropdowns = $('.dropdown');
    const $listOfOptions = $('.option');
    let currentDropdown = null; // Track the currently clicked dropdown
    let currentIndex = -1; // Track the currently focused option
    
    // Functions
    const toggleDropdown = (event) => {
        event.stopPropagation();
        const $currentDropdown = $(event.currentTarget).closest('.dropdown');
        
        // Close the previously opened dropdown if any
        $dropdowns.not($currentDropdown).removeClass('opened');
        
        $currentDropdown.toggleClass('opened');
        currentDropdown = $currentDropdown.hasClass('opened') ? $currentDropdown : null;
        currentIndex = -1; // Reset the current index when toggling the dropdown
    };
    
    const selectOption = (event) => {
        const $currentDropdown = currentDropdown;
        
        switch($currentDropdown.attr('id')) {
            case 'data-ant':
            socket.send("Z" + $(event.currentTarget).attr('data-value'));
            resetRDS(getCurrentFreq()); // Reset RDS when change antenna input
            break;
            case 'data-ant-phone':
            socket.send("Z" + $(event.currentTarget).attr('data-value'));
            resetRDS(getCurrentFreq()); // Reset RDS when change antenna input
            break;
            case 'data-bw':
            legacyBwValue = $(event.currentTarget).attr('data-value2') || "";
            socket.send("F" + legacyBwValue);
            socket.send("W" + $(event.currentTarget).attr('data-value'));
            $currentDropdown.find('input').val($(event.currentTarget).text());
            break;
            case 'data-bw-phone':
            legacyBwValue = $(event.currentTarget).attr('data-value2') || "";
            socket.send("F" + legacyBwValue);
            socket.send("W" + $(event.currentTarget).attr('data-value'));
            $currentDropdown.find('input').val($(event.currentTarget).text());
            break;
            case 'data-agc':
            socket.send("A" + $(event.currentTarget).attr('data-value'));
            $currentDropdown.find('input').val($(event.currentTarget).text());
            break;
            case 'data-agc-phone':
            socket.send("A" + $(event.currentTarget).attr('data-value'));
            $currentDropdown.find('input').val($(event.currentTarget).text());
            break;
            default:
            $currentDropdown.find('input')
            .val($(event.currentTarget).text())
            .attr('data-value', $(event.currentTarget).data('value')); 
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
    
    const navigateOptions = (event) => {
        if (!currentDropdown) return;
        
        const $options = currentDropdown.find('.option');
        switch (event.key) {
            case 'ArrowDown':
            event.preventDefault();
            currentIndex = (currentIndex + 1) % $options.length;
            $options.eq(currentIndex).focus();
            break;
            case 'ArrowUp':
            event.preventDefault();
            currentIndex = (currentIndex - 1 + $options.length) % $options.length;
            $options.eq(currentIndex).focus();
            break;
            case 'Enter':
            event.preventDefault();
            $options.eq(currentIndex).click();
            break;
            case 'Escape':
            currentDropdown.removeClass('opened');
            currentDropdown = null;
            currentIndex = -1;
            break;
        }
    };
    
    // Event Listeners
    $(document).on('click', closeDropdownFromOutside);
    $listOfOptions.on('click', selectOption);
    $dropdowns.on('click', 'input', toggleDropdown);
    $dropdowns.on('keydown', 'input', function(event) {
        if (event.key === 'Enter') {
            toggleDropdown(event);
        }
    });
    $dropdowns.on('keydown', '.option', navigateOptions);
    
    // MULTISELECT
    $('.multiselect option').mousedown(function(e) {
        e.preventDefault();
        var originalScrollTop = $(this).parent().scrollTop();
        $(this).prop('selected', $(this).prop('selected') ? false : true);
        var self = this;
        $(this).parent().focus();
        setTimeout(function() {
            $(self).parent().scrollTop(originalScrollTop);
        }, 0);
        
        return false;
    });
});
