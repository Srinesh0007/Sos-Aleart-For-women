const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Critical fix for Windows + Node 20/22+ 
// Disabling package exports prevents Metro from trying to create illegal 'node:' folders
config.resolver.unstable_enablePackageExports = false;
config.resolver.platforms = ['ios', 'android'];

module.exports = config;
