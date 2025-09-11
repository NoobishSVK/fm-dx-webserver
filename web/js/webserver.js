const versionDate = new Date('Sep 11, 2025 14:00:00');
const currentVersion = `v1.3.11 [${versionDate.getDate()}/${versionDate.getMonth() + 1}/${versionDate.getFullYear()}]`;


function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function loadScriptsInOrder() {
    await loadScript('./js/api.js');
    await loadScript('./js/main.js');
    await loadScript('./js/dropdown.js');
    await loadScript('./js/modal.js');
    await loadScript('./js/settings.js');
    await loadScript('./js/chat.js');
    await loadScript('./js/toast.js');
    await loadScript('./js/plugins.js');
}

loadScriptsInOrder();
