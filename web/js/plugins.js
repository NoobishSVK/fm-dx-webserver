function checkScroll() {
    let $container = $(".scrollable-container");
    let $leftArrow = $(".scroll-left");
    let $rightArrow = $(".scroll-right");

    let scrollWidth = $container[0].scrollWidth;
    let clientWidth = $container[0].clientWidth;
    let scrollLeft = $container.scrollLeft();
    let maxScrollLeft = scrollWidth - clientWidth;

    if (scrollWidth > clientWidth) {
        // If scrolling is possible, show arrows
        $leftArrow.stop(true, true).fadeIn(200).css("pointer-events", scrollLeft > 0 ? "auto" : "none").fadeTo(200, scrollLeft > 0 ? 1 : 0.2);
        $rightArrow.stop(true, true).fadeIn(200).css("pointer-events", scrollLeft < maxScrollLeft ? "auto" : "none").fadeTo(200, scrollLeft < maxScrollLeft ? 1 : 0.2);
    } else {
        // No scrolling needed, fully hide arrows
        $leftArrow.stop(true, true).fadeOut(200);
        $rightArrow.stop(true, true).fadeOut(200);
    }
}



$(document).ready(function () {
    let $container = $(".scrollable-container");
    let $leftArrow = $(".scroll-left");
    let $rightArrow = $(".scroll-right");

    // Scroll left/right when arrows are clicked
    $leftArrow.on("click", function () {
        $container.animate({ scrollLeft: "-=100" }, 300);
    });

    $rightArrow.on("click", function () {
        $container.animate({ scrollLeft: "+=100" }, 300);
    });

    // Detect scrolling
    $container.on("scroll", checkScroll);

    // Run checkScroll on page load to adjust visibility
    setTimeout(checkScroll, 100);
});

// Function to add buttons dynamically
function addIconToPluginPanel(id, text, iconType, icon, tooltip) {
    let $pluginButton = $(`
        <button class="no-bg color-4 hover-brighten ${tooltip ? "tooltip" : ""}" 
        style="padding: 6px; width: 64px; min-width: 64px;" id="${id}"
        data-tooltip="${tooltip ? tooltip : ""}" data-tooltip-placement="bottom">
            <i class="fa-${iconType} fa-${icon} fa-lg top-10"></i><br>
            <span style="font-size: 10px; color: var(--color-main-bright) !important;">${text}</span>
        </button>
    `);
    
    $('.scrollable-container').append($pluginButton);
    initTooltips($pluginButton);
    
    // Recheck scrolling when new buttons are added
    setTimeout(checkScroll, 100);
}
