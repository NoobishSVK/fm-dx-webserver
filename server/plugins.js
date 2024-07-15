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
            const destinationDir = path.join(__dirname, '../web/js/plugins', path.dirname(pluginConfig.frontEndPath));

            // Check if the source path exists
            if (!fs.existsSync(sourcePath)) {
                console.error(`Error: source path ${sourcePath} does not exist.`);
                return pluginConfig;
            }

            // Check if the destination directory exists, if not, create it
            if (!fs.existsSync(destinationDir)) {
                fs.mkdirSync(destinationDir, { recursive: true }); // Create directory recursively
            }

            const destinationFile = path.join(destinationDir, path.basename(sourcePath));

            // Platform-specific handling for symlinks/junctions
            if (process.platform !== 'win32') {
                // On Linux, create a symlink
                try {
                    if (fs.existsSync(destinationFile)) {
                        fs.unlinkSync(destinationFile); // Remove existing file/symlink
                    }
                    fs.symlinkSync(sourcePath, destinationFile);
                    setTimeout(function() {
                        consoleCmd.logInfo(`Plugin ${pluginConfig.name} ${pluginConfig.version} initialized successfully.`);  
                    }, 500)
                } catch (err) {
                    console.error(`Error creating symlink at ${destinationFile}: ${err.message}`);
                }
            }
        } else {
            console.error(`Error: frontEndPath is not defined in ${filePath}`);
        }
    } catch (err) {
        console.error(`Error parsing plugin config from ${filePath}: ${err.message}`);
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

// Ensure the web/js/plugins directory exists
const webJsPluginsDir = path.join(__dirname, '../web/js/plugins');
if (!fs.existsSync(webJsPluginsDir)) {
    fs.mkdirSync(webJsPluginsDir, { recursive: true });
}

// Main function to create symlinks/junctions for plugins
function createLinks() {
    const pluginsDir = path.join(__dirname, '../plugins');
    const destinationPluginsDir = path.join(__dirname, '../web/js/plugins');

    if (process.platform === 'win32') {
        // On Windows, create a junction
        try {
            if (fs.existsSync(destinationPluginsDir)) {
                fs.rmSync(destinationPluginsDir, { recursive: true });
            }
            fs.symlinkSync(pluginsDir, destinationPluginsDir, 'junction');
            setTimeout(function() {
                //consoleCmd.logInfo(`Plugin ${pluginConfig.name} ${pluginConfig.version} initialized successfully.`);  
            }, 500)
        } catch (err) {
            console.error(`Error creating junction at ${destinationPluginsDir}: ${err.message}`);
        }
    }
}

// Usage example
const allPluginConfigs = collectPluginConfigs();
createLinks();

module.exports = {
    allPluginConfigs
};
