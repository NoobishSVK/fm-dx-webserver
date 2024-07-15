const fs = require('fs');
const path = require('path');
const consoleCmd = require('./console');
const { serverConfig } = require('./server_config');

// Function to read all .js files in a directory
function readJSFiles(dir) {
    const files = fs.readdirSync(dir);
    return files.filter(file => file.endsWith('.js'));
}

// Function to parse plugin config from a file
function parsePluginConfig(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const pluginConfig = {};

    // Assuming pluginConfig is a JavaScript object defined in each .js file
    try {
        const pluginExports = require(filePath);
        Object.assign(pluginConfig, pluginExports.pluginConfig);

        // Check if pluginConfig has frontEndPath defined
        if (pluginConfig.frontEndPath) {
            const sourcePath = path.join(path.dirname(filePath), pluginConfig.frontEndPath);
            const destinationDir = path.join(path.dirname(filePath), '../web/js/plugins', pluginConfig.frontEndPath, '..');

            // Check if the destination directory exists, if not, create it
            if (!fs.existsSync(destinationDir)) {
                fs.mkdirSync(destinationDir, { recursive: true }); // Create directory recursively
            }

            // Copy the file to the destination directory
            const destinationFile = path.join(destinationDir, path.basename(sourcePath));
            fs.copyFileSync(sourcePath, destinationFile);
            setTimeout(function() {
                consoleCmd.logInfo(`Plugin ${pluginConfig.name} ${pluginConfig.version} initialized successfully.`);  
            }, 500)
        } else {
            console.error(`Error: frontEndPath is not defined in ${filePath}`);
        }
    } catch (err) {
        console.error(`Error parsing plugin config from ${filePath}: ${err}`);
    }

    return pluginConfig;
}

// Main function to collect plugin configs from all .js files in the 'plugins' directory
function collectPluginConfigs() {
    const pluginsDir = path.join(__dirname, '../plugins');
    const jsFiles = readJSFiles(pluginsDir);

    const pluginConfigs = [];
    jsFiles.forEach(file => {
        const filePath = path.join(pluginsDir, file);
        const config = parsePluginConfig(filePath);
        if (Object.keys(config).length > 0) {
            pluginConfigs.push(config);
        }
    });

    return pluginConfigs;
}

// Usage example
const allPluginConfigs = collectPluginConfigs();

module.exports = {
    allPluginConfigs
}