// Versão atual dos tokens de cada usuário. Incrementar a versão (troca de
// senha, "sair de todos os aparelhos") invalida todo JWT emitido antes.
// Separado do middleware para os testes com banco mockado poderem simulá-lo.
const { pool } = require('../db');

async function currentTokenVersion(userId) {
  const { rows } = await pool.query('SELECT token_version FROM users WHERE id=$1', [userId]);
  return rows.length ? rows[0].token_version : null;
}

module.exports = { currentTokenVersion };
