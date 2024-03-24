var currentDate = new Date('March 24, 2024 19:00:00');
var day = currentDate.getDate();
var month = currentDate.getMonth() + 1; // Months are zero-indexed, so add 1
var year = currentDate.getFullYear();
var formattedDate = day + '/' + month + '/' + year;
var currentVersion = 'v1.1.7 [' + formattedDate + ']';

    
    /**
    * Themes
    * @param first color
    * @param second color
    * @param text color
    */
    const themes = {
        theme1: ['rgba(32, 34, 40, 1)', 'rgba(88, 219, 171, 1)', 'rgba(255, 255, 255, 1)' ], // Retro (Default)
        theme2: [ 'rgba(21, 32, 33, 1)', 'rgba(203, 202, 165, 1)', 'rgba(255, 255, 255, 1)' ], // Cappuccino
        theme3: [ 'rgba(18, 18, 12, 1)', 'rgba(169, 255, 112, 1)', 'rgba(255, 255, 255, 1)' ], // Nature
        theme4: [ 'rgba(12, 28, 27, 1)', 'rgba(104, 247, 238, 1)', 'rgba(255, 255, 255, 1)' ], // Ocean
        theme5: [ 'rgba(23, 17, 6, 1)', 'rgba(245, 182, 66, 1)', 'rgba(255, 255, 255, 1)' ], // Terminal
        theme6: [ 'rgba(33, 9, 29, 1)', 'rgba(250, 82, 141, 1)', 'rgba(255, 255, 255, 1)' ], // Nightlife
        theme7: [ 'rgba(13, 11, 26, 1)', 'rgba(128, 105, 250, 1)', 'rgba(255, 255, 255, 1)' ], // Blurple
        theme8: [ 'rgba(252, 186, 3, 1)', 'rgba(0, 0, 0, 1)', 'rgba(0, 0, 0, 1)' ], // Construction
        theme9: [ 'rgba(0, 0, 0, 1)', 'rgba(204, 204, 204, 1)', 'rgba(255, 255, 255, 1)' ], // AMOLED
    };      
    
    // Signal Units
    const signalUnits = {
        dbf: ['dBf'],
        dbuv: ['dBµV'],
        dbm: ['dBm'],
    };
    
    $(document).ready(() => {
        // Theme Selector
        const themeSelector = $('#theme-selector');
        const savedTheme = localStorage.getItem('theme');
        const defaultTheme = localStorage.getItem('defaultTheme');
        const savedUnit = localStorage.getItem('signalUnit');

        if(defaultTheme && themes[defaultTheme]) {
            setTheme(defaultTheme);
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
        
        // Signal Selector
        const signalSelector = $('#signal-selector');
        
        if (localStorage.getItem('signalUnit')) {
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
        
        // Assuming you have an anchor tag with id 'logout-link'
        $('.logout-link').click(function (event) {
            event.preventDefault();
            
            // Perform an AJAX request to the /logout endpoint
            $.ajax({
                type: 'GET',  // Assuming the logout is a GET request, adjust accordingly
                url: './logout',
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
        
        var extendedFreqRange = localStorage.getItem("extendedFreqRange");
        if (extendedFreqRange === "true") {
            $("#extended-frequency-range").prop("checked", true);
        }
        
        // Save the value of the checkbox into local storage when its state changes
        $("#extended-frequency-range").change(function() {
            var isChecked = $(this).is(":checked");
            localStorage.setItem("extendedFreqRange", isChecked);
        });
        
        var extendedFreqRange = localStorage.getItem("psUnderscores");
        if (extendedFreqRange === "true") {
            $("#ps-underscores").prop("checked", true);
        }

        var smoothSignal = localStorage.getItem("smoothSignal");
        if (smoothSignal === "true") {
            $("#smooth-signal").prop("checked", true);
        }
        
        // Save the value of the checkbox into local storage when its state changes
        $("#ps-underscores").change(function() {
            var isChecked = $(this).is(":checked");
            localStorage.setItem("psUnderscores", isChecked);
        });

        $("#smooth-signal").change(function() {
            var isChecked = $(this).is(":checked");
            localStorage.setItem("smoothSignal", isChecked);
        });
        
        $('.version-string').text(currentVersion);

        setBg();
    });
    
    
    function setTheme(themeName) {
        const themeColors = themes[themeName];
        if (themeColors) {
            // Extracting the RGBA components and opacity value
            const rgbaComponents = themeColors[2].match(/(\d+(\.\d+)?)/g);
            const opacity = parseFloat(rgbaComponents[3]);
            // Calculating 80% of the opacity
            const newOpacity = opacity * 0.75;
            // Constructing the new RGBA string with the adjusted opacity
            const textColor2 = `rgba(${rgbaComponents[0]}, ${rgbaComponents[1]}, ${rgbaComponents[2]}, ${newOpacity})`;
            
            $(':root').css('--color-main', themeColors[0]);
            $(':root').css('--color-main-bright', themeColors[1]);
            $(':root').css('--color-text', themeColors[2]);
            $(':root').css('--color-text-2', textColor2);
        }
    }
    
    function setBg() {
        if(localStorage.getItem('bgImage').length > 1 && localStorage.getItem('theme') != 'theme8') {
            $('body').css('background', 'url(' + localStorage.getItem('bgImage') + ') top center / cover fixed no-repeat var(--color-main)');
        } else {
            $('body').css('background', 'var(--color-main)');
        }
    }