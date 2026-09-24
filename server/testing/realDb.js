// Sobe um PostgreSQL 16 real e descartável para testes de integridade que um
// banco mockado não consegue provar: constraints, cascade, isolamento entre
// usuários e concorrência. Usa os binários do pacote embedded-postgres
// diretamente (o pacote em si é ESM e o Jest deste projeto roda em CommonJS).
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

function binDir() {
  const pkg = `@embedded-postgres/${process.platform}-${process.arch}`;
  // O pacote só exporta dist/index.js; a raiz dele fica um nível acima.
  return path.join(path.dirname(require.resolve(pkg)), '..', 'native', 'bin');
}

async function startRealDb() {
  const bin = binDir();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amigofit-pg-'));
  const pwFile = path.join(dataDir, '..', `${path.basename(dataDir)}.pw`);
  fs.writeFileSync(pwFile, 'amigofit');
  const port = 55000 + Math.floor(Math.random() * 5000);

  execFileSync(path.join(bin, 'initdb'), [
    '-D', dataDir, '-U', 'amigofit', '--pwfile', pwFile, '-A', 'password', '--no-sync', '-E', 'UTF8',
  ], { stdio: 'ignore' });
  execFileSync(path.join(bin, 'pg_ctl'), [
    '-D', dataDir, '-o', `-p ${port} -k ${dataDir} -c fsync=off`, '-w', '-l', path.join(dataDir, 'log.txt'), 'start',
  ], { stdio: 'ignore' });

  Object.assign(process.env, {
    DB_HOST: 'localhost', DB_PORT: String(port), DB_NAME: 'postgres',
    DB_USER: 'amigofit', DB_PASSWORD: 'amigofit',
  });

  return {
    async stop() {
      execFileSync(path.join(bin, 'pg_ctl'), ['-D', dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore' });
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(pwFile, { force: true });
    },
  };
}

module.exports = { startRealDb };
