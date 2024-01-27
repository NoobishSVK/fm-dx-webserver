/* Themes */
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

/* Signal Units */
const signalUnits = {
  dbf: ['dBf'],
  dbuv: ['dBµV'],
  dbm: ['dBm'],
};

$(document).ready(() => {
  const themeSelector = $('#theme-selector');
  const savedTheme = localStorage.getItem('theme');

  if (savedTheme && themes[savedTheme]) {
    setTheme(savedTheme);
    themeSelector.val(savedTheme);
  }

  themeSelector.on('change', (event) => {
    const selectedTheme = event.target.value;
    setTheme(selectedTheme);
    localStorage.setItem('theme', selectedTheme);
  });

  const signalSelector = $('#signal-selector');

  if (localStorage.getItem('signalUnit')) {
    signalSelector.val(localStorage.getItem('signalUnit'));
  }

  signalSelector.on('change', (event) => {
    const selectedSignalUnit = event.target.value;
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
