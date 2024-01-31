    // Themes
    const themes = {
      theme1: ['#111', '#aaa'],
      theme2: ['#1f0c0c', '#ff7070'],
      theme3: ['#121c0c', '#a9ff70'],
      theme4: ['#0c1c1b', '#68f7ee'],
      theme5: ['#171106', '#f5b642'],
      theme6: ['#21091d', '#ed51d3'],
      theme7: ['#1d1838', '#8069fa'],
      theme8: ['#000', '#888'],
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
    const savedUnit = localStorage.getItem('signalUnit');

    if (savedTheme && themes[savedTheme]) {
        setTheme(savedTheme);
        themeSelector.find('input').val(themeSelector.find('.option[data-value="' + savedTheme + '"]').text());
    }

    themeSelector.on('click', '.option', (event) => {
        const selectedTheme = $(event.target).data('value');
        setTheme(selectedTheme);
        themeSelector.find('input').val($(event.target).text()); // Set the text of the clicked option to the input
        localStorage.setItem('theme', selectedTheme);
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
});


  function setTheme(themeName) {
      const themeColors = themes[themeName];
      if (themeColors) {
          $(':root').css('--color-main', themeColors[0]);
          $(':root').css('--color-main-bright', themeColors[1]);
      }
  }