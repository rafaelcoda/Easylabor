const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
// Permite importar o cliente compartilhado da API, que fica fora desta pasta.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../packages/client')];
module.exports = config;
