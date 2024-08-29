/**
* Themes
* @param main color
* @param main-bright color
* @param text color
* @param background filter color
*/
const themes = {
    theme1: [ 'rgb(32, 34, 40)', 'rgb(88, 219, 171)', 'rgb(255, 255, 255)', 'rgb(11, 12, 14)' ], // Retro (Default)
    theme2: [ 'rgb(21, 32, 33)', 'rgb(203, 202, 165)', 'rgb(255, 255, 255)', 'rgb(7, 11, 12)' ], // Cappuccino
    theme3: [ 'rgb(18, 18, 12)', 'rgb(169, 255, 112)', 'rgb(255, 255, 255)', 'rgb(6, 6, 4)' ], // Nature
    theme4: [ 'rgb(12, 28, 27)', 'rgb(104, 247, 238)', 'rgb(255, 255, 255)', 'rgb(4, 10, 9)' ], // Ocean
    theme5: [ 'rgb(23, 17, 6)', 'rgb(245, 182, 66)', 'rgb(255, 255, 255)', 'rgb(8, 6, 2)' ], // Terminal
    theme6: [ 'rgb(33, 9, 29)', 'rgb(250, 82, 141)', 'rgb(255, 255, 255)', 'rgb(12, 3, 10)' ], // Nightlife
    theme7: [ 'rgb(13, 11, 26)', 'rgb(128, 105, 250)', 'rgb(255, 255, 255)', 'rgb(5, 4, 7)' ], // Blurple
    theme8: [ 'rgb(252, 186, 3)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(252, 186, 3)' ], // Construction
    theme9: [ 'rgb(0, 0, 0)', 'rgb(204, 204, 204)', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)' ], // AMOLED
};

// Signal Units
const signalUnits = {
    dbf: ['dBf'],
    dbuv: ['dBµV'],
    dbm: ['dBm'],
};

$(document).ready(() => {
    const themeSelector = $('#theme-selector');
    const savedTheme = localStorage.getItem('theme');
    const defaultTheme = localStorage.getItem('defaultTheme');
    const savedUnit = localStorage.getItem('signalUnit');
    
    if(defaultTheme && themes[defaultTheme]) {
        setTheme(defaultTheme);
    }

    const themeParameter = getQueryParameter('theme');
    if(themeParameter && themes[themeParameter]) {
        setTheme(themeParameter);
        themeSelector.find('input').val(themeSelector.find('.option[data-value="' + themeParameter + '"]').text());
    }
    
    if (savedTheme && themes[savedTheme]) {
        setTheme(savedTheme);
        themeSelector.find('input').val(themeSelector.find('.option[data-value="' + savedTheme + '"]').text());
    }
    
    themeSelector.on('click', '.option', (event) => {
        const selectedTheme = $(event.target).data('value');
        setTheme(selectedTheme);
        themeSelector.find('input').val($(event.target).text()); // Set the text of the clicked option to the input
        localStorage.setItem('theme', selectedTheme);
        setBg();
    });
    
    const signalSelector = $('#signal-selector');
    
    const signalParameter = getQueryParameter('signalUnits');
    if(signalParameter && !localStorage.getItem('signalUnit')) {
        signalSelector.find('input').val(signalSelector.find('.option[data-value="' + signalParameter + '"]').text());
        localStorage.setItem('signalUnit', signalParameter);
    } else {
        signalSelector.find('input').val(signalSelector.find('.option[data-value="' + savedUnit + '"]').text());
    }
    
    signalSelector.on('click', '.option', (event) => {
        const selectedSignalUnit = $(event.target).data('value');
        signalSelector.find('input').val($(event.target).text()); // Set the text of the clicked option to the input
        localStorage.setItem('signalUnit', selectedSignalUnit);
    });
    
    $('#login-form').submit(function (event) {
        event.preventDefault();
        
        // Perform an AJAX request to the /login endpoint
        $.ajax({
            type: 'POST',
            url: './login',
            data: $(this).serialize(),
            success: function (data) {
                // Update the content on the page with the message from the response
                $('#login-message').text(data.message);
                setTimeout(function () {
                    location.reload(true);
                }, 1750);
            },
            error: function (xhr, status, error) {
                // Handle error response
                if (xhr.status === 403) {
                    // Update the content on the page with the message from the error response
                    $('#login-message').text(xhr.responseJSON.message);
                } else {
                    // Handle other types of errors if needed
                    console.error('Error:', status, error);
                }
            }
        });
    });    
    
    $('.logout-link').click(function (event) {
        event.preventDefault();
        
        // Perform an AJAX request to the /logout endpoint
        $.ajax({
            type: 'GET',  // Assuming the logout is a GET request, adjust accordingly
            url: './logout',
            success: function (data) {
                $('#login-message').text(data.message);
                setTimeout(function () {
                    location.reload(true);
                }, 1000);
            },
            error: function (xhr, status, error) {
                // Handle error response
                if (xhr.status === 403) {
                    // Update the content on the page with the message from the error response
                    $('#login-message').text(xhr.responseJSON.message);
                } else {
                    // Handle other types of errors if needed
                    console.error('Error:', status, error);
                }
            }
        });
    });
    
    var extendedFreqRange = localStorage.getItem("extendedFreqRange");
    if (extendedFreqRange === "true") {
        $("#extended-frequency-range").prop("checked", true);
    }
    
    $("#extended-frequency-range").change(function() {
        var isChecked = $(this).is(":checked");
        localStorage.setItem("extendedFreqRange", isChecked);
    });
    
    const psUnderscoreParameter = getQueryParameter('psUnderscores');
    if(psUnderscoreParameter) {
        $("#ps-underscores").prop("checked", JSON.parse(psUnderscoreParameter));
    }
    
    var psUnderscores = localStorage.getItem("psUnderscores");
    if (psUnderscores) {
        $("#ps-underscores").prop("checked", JSON.parse(psUnderscores));
        localStorage.setItem("psUnderscores", psUnderscores);
    }
    
    $("#ps-underscores").change(function() {
        var isChecked = $(this).is(":checked");
        console.log(isChecked);
        localStorage.setItem("psUnderscores", isChecked);
    });
    
    $('.version-string').text(currentVersion);
    
    setBg();
});

function getQueryParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

function setTheme(themeName) {
    const themeColors = themes[themeName];
    if (themeColors) {
        // Extracting the RGBA components from themeColors[2] for --color-text-2
        const rgbaComponentsText = themeColors[2].match(/(\d+(\.\d+)?)/g);
        const opacityText = parseFloat(rgbaComponentsText[3]);
        const newOpacityText = opacityText * 0.75;
        const textColor2 = `rgba(${rgbaComponentsText[0]}, ${rgbaComponentsText[1]}, ${rgbaComponentsText[2]})`;

        // Extracting the RGBA components from themeColors[0] for background color
        const rgbaComponentsBackground = themeColors[3].match(/(\d+(\.\d+)?)/g);
        const backgroundOpacity = 0.75;
        const backgroundColorWithOpacity = `rgba(${rgbaComponentsBackground[0]}, ${rgbaComponentsBackground[1]}, ${rgbaComponentsBackground[2]}, ${backgroundOpacity})`;

        $(':root').css('--color-main', themeColors[0]);
        $(':root').css('--color-main-bright', themeColors[1]);
        $(':root').css('--color-text', themeColors[2]);
        $(':root').css('--color-text-2', textColor2);
        $('#wrapper-outer').css('background-color', backgroundColorWithOpacity);
    }
}

function setBg() {
    const disableBackgroundParameter = getQueryParameter('disableBackground');
    if(localStorage.getItem('bgImage').length > 5 && localStorage.getItem('theme') != 'theme9' && disableBackgroundParameter != 'true') {
        $('body').css('background', 'url(' + localStorage.getItem('bgImage') + ') top center / cover fixed no-repeat var(--color-main)');
    } else {
        $('body').css('background', 'var(--color-main)');
    }
}