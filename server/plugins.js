const fs = require('fs');
const path = require('path');
const consoleCmd = require('./console');
const { serverConfig } = require('./server_config');

let isCopyingFilesInsteadOfJunction = true;

// Function to read all .js files in a directory
function readJSFiles(dir) {
    const files = fs.readdirSync(dir);
    return files.filter(file => file.endsWith('.js'));
}

// Delete "plugins" link if it exists (will be recreated)
const pluginsPath = path.join(__dirname, '../web/js/plugins');
const relativePluginsPath = path.relative(__dirname, pluginsPath);

if (fs.existsSync(pluginsPath)) {
    const stats = fs.lstatSync(pluginsPath);
    if (stats.isSymbolicLink() || stats.isDirectory()) {
        // Remove if junction, symlink, or directory
        fs.rmSync(pluginsPath, { recursive: true });
    } else {
        // Unlink if hard link
        fs.unlinkSync(pluginsPath);
    }
} else {
    consoleCmd.logInfo(`Creating link: '${relativePluginsPath}'`);
}

// Function to parse plugin config from a file
let fallbackJunction = false;
function parsePluginConfig(filePath) {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const pluginConfig = {};

    try {
        const pluginExports = require(filePath);
        Object.assign(pluginConfig, pluginExports.pluginConfig);

        if (pluginConfig.frontEndPath) {
            const sourcePath = path.join(path.dirname(filePath), pluginConfig.frontEndPath);
            const destinationDir = path.join(__dirname, '../web/js/plugins', path.dirname(pluginConfig.frontEndPath));

            // Check if the source path exists
            if (!fs.existsSync(sourcePath)) {
                const relativeSourcePath = path.relative(__dirname, sourcePath);
                consoleCmd.logError(`Source path ${relativeSourcePath} does not exist.`);
                return pluginConfig;
            }

            // Check if the destination directory exists, if not, create it
            if (!fs.existsSync(destinationDir)) {
                fs.mkdirSync(destinationDir, { recursive: true }); // Create directory recursively
            }

            const destinationFile = path.join(destinationDir, path.basename(sourcePath));

            // Platform-specific handling for symlinks/hard links
            if (process.platform === 'win32') {
                // Check if the "plugins" junction exists and remove it if necessary
                const pluginsJunctionPath = path.join(__dirname, '../web/js/plugins');
                if (fs.existsSync(pluginsJunctionPath)) {
                    try {
                        const stats = fs.lstatSync(pluginsJunctionPath);

                        if (stats.isSymbolicLink() || stats.isDirectory()) {
                            const linkTarget = fs.readlinkSync(pluginsJunctionPath);
                            if (linkTarget && fs.existsSync(linkTarget) && fs.lstatSync(linkTarget).isDirectory()) {
                                // Remove junction
                                fs.unlinkSync(pluginsJunctionPath);
                                const relativeJunctionPath = path.relative(__dirname, pluginsJunctionPath);
                                if (!fallbackJunction) consoleCmd.logInfo(`Junction removed: ${relativeJunctionPath}`);

                                // Create destination directory now so first plugin hard link can be created
                                if (!fs.existsSync(destinationDir)) {
                                    fs.mkdirSync(destinationDir, { recursive: true }); // Create directory recursively
                                }
                            }
                        }
                    } catch (err) {
                        if (err.code !== 'EINVAL') {
                            consoleCmd.logError(`Error checking or removing junction at ${pluginsJunctionPath}: ${err.message}`);
                        }
                    }
                }

                // Attempt to create hard link, fallback to symlink, and then junction if necessary
                try {
                    fs.linkSync(sourcePath, destinationFile); // Create hard link
                    const relativeSourcePath = path.relative(__dirname, sourcePath);
                    const relativeDestinationPath = path.relative(__dirname, destinationFile);

                    setTimeout(() => {
                        //consoleCmd.logInfo(`Plugin ${pluginConfig.name} ${pluginConfig.version} initialized successfully.`);
                    }, 500);
                } catch (err) {
                    if (err.code === 'EEXIST') {
                        const relativeDestinationPath = path.relative(__dirname, destinationFile);

                        setTimeout(() => {
                            consoleCmd.logInfo(`Plugin ${pluginConfig.name} ${pluginConfig.version} initialized successfully.`);
                        }, 500);
                    } else {
                        // Fallback to symlink if hard link creation fails
                        try {
                            if (fs.existsSync(destinationFile)) {
                                fs.unlinkSync(destinationFile); // Remove existing symlink
                            }
                            fs.symlinkSync(sourcePath, destinationFile); // Create symbolic link
                            const relativeDestinationPath = path.relative(__dirname, destinationFile);

                            setTimeout(() => {
                                consoleCmd.logInfo(`Plugin ${pluginConfig.name} ${pluginConfig.version} initialized successfully.`);
                            }, 500);
                        } catch (err) {
                            if (err.code !== 'EPERM') {
                                consoleCmd.logError(`Error creating symlink: ${destinationFile}: ${err.message}`);
                            }
                            // If symlink creation fails, attempt to copy files, or create a junction instead
                            const pluginsDir = path.join(__dirname, '../plugins');
                            const destinationPluginsDir = path.join(__dirname, '../web/js/plugins');

                            try {
                              if (isCopyingFilesInsteadOfJunction) {
                                  const destinationFile = path.join(destinationDir, path.basename(sourcePath));
                                  fs.copyFileSync(sourcePath, destinationFile);
                                  const relativeSourcePath = path.relative(__dirname, sourcePath);
                                  const relativeDestinationPath = path.relative(__dirname, destinationFile);

                              } else {
                                    if (fs.existsSync(destinationPluginsDir)) {
                                        fs.rmSync(destinationPluginsDir, { recursive: true });
                                    }
                                    fs.symlinkSync(pluginsDir, destinationPluginsDir, 'junction');
                                    const relativeJunctionPath = path.relative(__dirname, destinationFile);

                                    setTimeout(function() {
                                        consoleCmd.logInfo(`Plugin ${pluginConfig.name} ${pluginConfig.version} initialized successfully.`);  
                                    }, 500)
                                    fallbackJunction = true;
                                }
                            } catch (err) {
                                consoleCmd.logError(`Error at: ${destinationPluginsDir}: ${err.message}`);
                            }
                        }
                    }
                }
            } else {
                // If not Windows, create a symlink
                try {
                    if (fs.existsSync(destinationFile)) {
                        fs.unlinkSync(destinationFile); // Remove existing symlink
                    } else {
                        const relativeSourcePath = path.relative(__dirname, sourcePath);
                        const relativeDestinationPath = path.relative(__dirname, destinationFile);
                    }
                    fs.symlinkSync(sourcePath, destinationFile); // Create symbolic link
                    setTimeout(() => {
                        consoleCmd.logInfo(`Plugin ${pluginConfig.name} ${pluginConfig.version} initialized successfully.`);
                    }, 500);
                } catch (err) {
                    consoleCmd.logError(`Error creating symlink at ${destinationFile}: ${err.message}`);
                }
            }
        } else {
            consoleCmd.logError(`Error: frontEndPath is not defined in ${filePath}`);
        }
    } catch (err) {
        consoleCmd.logError(`Error parsing plugin config from ${filePath}: ${err.message}`);
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

// Run the script
const allPluginConfigs = collectPluginConfigs();
if (fallbackJunction) {
  consoleCmd.logInfo(`Junction created: '..\\web\\js\\plugins'`);
  consoleCmd.logWarn(`Warning: All files in 'plugins' folder are exposed when using junction link!`);
}

module.exports = {
    allPluginConfigs
};
