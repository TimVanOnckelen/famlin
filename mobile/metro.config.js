const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// mobile/package.json pulls in @famlin/api-client via `file:../packages/api-client`,
// which npm installs as a symlink. Metro resolves symlinks to their real path and
// then does node_modules resolution relative to that real path — so the package's
// own deps (axios, @tanstack/react-query), hoisted to the workspace root by `npm
// install` there, need to be reachable by walking up from packages/api-client, not
// from mobile/node_modules. watchFolders is separately needed so Metro's dev-server
// file watcher notices edits under packages/api-client/src.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
