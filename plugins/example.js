// Plugin configuration, this is used in the administration when plugins are loaded
var pluginConfig = {
    name: 'Example plugin',
    version: '1.0',
    author: 'OpenRadio',
    frontEndPath: 'example/frontend.js'
}

// Backend (server) changes can go here...

// Don't change anything below here if you are making your own plugin
module.exports = {
    pluginConfig
}