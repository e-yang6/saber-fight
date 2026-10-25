const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Share class/color definitions and message types with the game instead of copying them
config.watchFolders = [path.resolve(__dirname, '../src/shared')];

module.exports = config;
