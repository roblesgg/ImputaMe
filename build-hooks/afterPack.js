const { rcedit } = require('rcedit');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await rcedit(exePath, { icon: path.join(__dirname, '..', 'assets', 'icon.ico') });
};
