const tooltipDescriptions = new Map(); // tooltip text -> id of its hidden description element

function initTooltips(target = null) {
    const tooltips = target ? $(target) : $('.tooltip');

    // Screen readers: point aria-describedby at a hidden copy of the tooltip text (one element per unique text)
    tooltips.each(function () {
        const text = $(this).attr('data-tooltip');
        if (!text || text === $(this).attr('aria-label')) return;
        if (!tooltipDescriptions.has(text)) {
            const id = `tooltip-desc-${tooltipDescriptions.size}`;
            $('<span hidden>').attr('id', id).html(text).appendTo('body');
            tooltipDescriptions.set(text, id);
        }
        $(this).attr('aria-describedby', tooltipDescriptions.get(text));
    });

    // Unbind existing event handlers before rebinding to avoid duplication
    tooltips.off('mouseenter mouseleave focusin focusout');

    tooltips.on('mouseenter focusin', function () {
        if ($(this).closest('.popup-content').length) {
            return;
        }
        
        var tooltipText = $(this).data('tooltip');
        var placement = $(this).data('tooltip-placement') || 'top'; // Default to 'top'
        
        // Clear existing timeouts
        $(this).data('timeout', setTimeout(() => {
            $('.tooltip-wrapper').remove();
            
            var tooltip = $(`
                <div class="tooltip-wrapper" aria-hidden="true">
                    <div class="tooltiptext">${tooltipText}</div>
                </div>
            `);
                $('body').append(tooltip);
                
                var tooltipEl = $('.tooltiptext');
                var tooltipWidth = tooltipEl.outerWidth();
                var tooltipHeight = tooltipEl.outerHeight();
                var targetEl = $(this);
                var targetOffset = targetEl.offset();
                var targetWidth = targetEl.outerWidth();
                var targetHeight = targetEl.outerHeight();
                
                // Compute position
                var posX, posY;
                switch (placement) {
                    case 'bottom':
                    posX = targetOffset.left + targetWidth / 2 - tooltipWidth / 2;
                    posY = targetOffset.top + targetHeight + 10;
                    break;
                    case 'left':
                    posX = targetOffset.left - tooltipWidth - 10;
                    posY = targetOffset.top + targetHeight / 2 - tooltipHeight / 2;
                    break;
                    case 'right':
                    posX = targetOffset.left + targetWidth + 10;
                    posY = targetOffset.top + targetHeight / 2 - tooltipHeight / 2;
                    break;
                    case 'top':
                    default:
                    posX = targetOffset.left + targetWidth / 2 - tooltipWidth / 2;
                    posY = targetOffset.top - tooltipHeight - 10;
                    break;
                }
                
                tooltipEl.css({ top: posY, left: posX, opacity: 1 });

                // For touchscreen devices
                if ((/Mobi|Android|iPhone|iPad|iPod|Opera Mini/i.test(navigator.userAgent)) && ('ontouchstart' in window || navigator.maxTouchPoints)) {
                    setTimeout(() => { $('.tooltiptext').remove(); }, 5000);
                }
                
            }, 300));
        }).on('mouseleave focusout', function () {
            clearTimeout($(this).data('timeout'));
            
            setTimeout(() => {
                $('.tooltip-wrapper').fadeOut(300, function () {
                    $(this).remove(); 
                });
            }, 100); 
        });
        
        $('.popup-content').off('mouseenter').on('mouseenter', function () {
            clearTimeout($('.tooltip').data('timeout'));
            $('.tooltip-wrapper').fadeOut(300, function () {
                $(this).remove(); 
            });
        });
    }

$(() => initTooltips());
