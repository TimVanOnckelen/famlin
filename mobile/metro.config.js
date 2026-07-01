const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Reduce the number of files Metro watches to avoid EMFILE errors
config.watchFolders = [__dirname];
config.resolver.blockList = /node_modules\/.*\/node_modules/;

module.exports = config;
