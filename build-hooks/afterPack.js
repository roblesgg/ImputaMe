const { rcedit } = require('rcedit');
const path = require('path');

// En package.json está signAndEditExecutable:false, que apaga el paso en el que
// electron-builder reescribe los datos del .exe. Eso deja dentro los de Electron, y por
// eso el Administrador de tareas (y los servicios) mostraban "Electron" en vez de
// "imputa.me", y la versión del fichero salía como la de Electron (31.x) en lugar de la
// de la app. Aquí se escriben a mano, que es lo único que faltaba: el icono ya se ponía
// así desde el principio.
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const info = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${info.productFilename}.exe`);
  const version = info.version;

  await rcedit(exePath, {
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    'file-version': version,
    'product-version': version,
    'version-string': {
      // FileDescription es lo que el Administrador de tareas enseña como nombre.
      FileDescription: info.productName,
      ProductName: info.productName,
      CompanyName: info.companyName || 'imputa.me',
      LegalCopyright: info.copyright || `Copyright © ${new Date().getFullYear()} imputa.me`,
      InternalName: info.productName,
      OriginalFilename: `${info.productFilename}.exe`,
    },
  });
};
