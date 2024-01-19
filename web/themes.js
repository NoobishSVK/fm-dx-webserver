const themes = {
  theme1: {
    '--color-main': '#1d1838',
    '--color-main-bright': '#8069fa',
  },
  theme2: {
    '--color-main': '#381818',
    '--color-main-bright': '#ff7070',
  },
  theme3: {
    '--color-main': '#121c0c',
    '--color-main-bright': '#a9ff70',
  },
  theme4: {
    '--color-main': '#0c1c1b',
    '--color-main-bright': '#68f7ee',
  },
  theme5: {
    '--color-main': '#171106',
    '--color-main-bright': '#f5b642',
  },
  theme6: {
    '--color-main': '#21091d',
    '--color-main-bright': '#ed51d3',
  }
};


function setTheme(themeName) {
  const theme = themes[themeName];
  if (theme) {
    for (const [variable, value] of Object.entries(theme)) {
      document.documentElement.style.setProperty(variable, value);
    }
  }
}

// Get the dropdown element
const themeSelector = document.getElementById('theme-selector');

const savedTheme = localStorage.getItem("theme");
if(savedTheme) {
  setTheme(savedTheme);
  themeSelector.value = savedTheme;
}

// Listen for changes in the dropdown
themeSelector.addEventListener('change', (event) => {
  const selectedTheme = event.target.value;
  setTheme(selectedTheme);
  localStorage.setItem("theme", selectedTheme);

});
