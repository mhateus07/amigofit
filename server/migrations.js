// Migrações versionadas do banco. Cada migração roda uma única vez, dentro de
// uma transação, e fica registrada em schema_migrations. Nunca edite uma
// migração que já rodou em produção — crie uma nova no fim da lista.
const MIGRATIONS = [
  {
    id: 1,
    name: 'schema inicial',
    // Idempotente (IF NOT EXISTS) porque o banco de produção já existia antes
    // do controle de migrações — nele, esta migração só é registrada.
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id),
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        extracted_data JSONB,
        timestamp BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS extracted_data (
        id SERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        category TEXT NOT NULL,
        label TEXT NOT NULL,
        value TEXT NOT NULL,
        raw_text TEXT,
        timestamp BIGINT NOT NULL,
        source_ref TEXT
      );
      ALTER TABLE extracted_data ADD COLUMN IF NOT EXISTS source_ref TEXT;
      CREATE TABLE IF NOT EXISTS meals (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        name TEXT NOT NULL,
        time TEXT NOT NULL,
        description TEXT,
        items JSONB,
        source TEXT NOT NULL DEFAULT 'manual',
        active BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS meal_checkins (
        id SERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        meal_id TEXT REFERENCES meals(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        status TEXT NOT NULL,
        checked_at BIGINT,
        UNIQUE (meal_id, date)
      );
      CREATE TABLE IF NOT EXISTS workout_plans (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        name TEXT NOT NULL,
        day_label TEXT,
        exercises JSONB NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'manual',
        active BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS workout_checkins (
        id SERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        workout_plan_id TEXT REFERENCES workout_plans(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        status TEXT NOT NULL,
        checked_at BIGINT,
        UNIQUE (workout_plan_id, date)
      );
      CREATE TABLE IF NOT EXISTS exercise_videos (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    id: 2,
    name: 'check-ins presos ao dono do plano, sem cascade',
    // Antes, salvar o plano apagava as refeições/fichas e o ON DELETE CASCADE
    // levava junto todo o histórico de check-ins. Agora os planos são
    // arquivados (active=false), nunca apagados, e a FK composta
    // (id, user_id) impede check-in em refeição/ficha de outra conta.
    // NOT VALID: vale para toda linha nova sem travar o deploy em dados antigos.
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS meals_id_user_idx ON meals (id, user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS workout_plans_id_user_idx ON workout_plans (id, user_id);
      ALTER TABLE meal_checkins DROP CONSTRAINT IF EXISTS meal_checkins_meal_id_fkey;
      ALTER TABLE meal_checkins ADD CONSTRAINT meal_checkins_meal_owner_fkey
        FOREIGN KEY (meal_id, user_id) REFERENCES meals (id, user_id) NOT VALID;
      ALTER TABLE workout_checkins DROP CONSTRAINT IF EXISTS workout_checkins_workout_plan_id_fkey;
      ALTER TABLE workout_checkins ADD CONSTRAINT workout_checkins_plan_owner_fkey
        FOREIGN KEY (workout_plan_id, user_id) REFERENCES workout_plans (id, user_id) NOT VALID;
    `,
  },
];

async function runMigrations(pool, migrations = MIGRATIONS) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  const { rows } = await pool.query('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.id));
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Evita duas instâncias migrando ao mesmo tempo durante um deploy.
      await client.query('SELECT pg_advisory_xact_lock(4242)');
      const again = await client.query('SELECT 1 FROM schema_migrations WHERE id=$1', [m.id]);
      if (again.rowCount === 0) {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1,$2)', [m.id, m.name]);
        console.log(`Migração ${m.id} aplicada: ${m.name}`);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`Migração ${m.id} (${m.name}) falhou: ${e.message}`);
    } finally {
      client.release();
    }
  }
}

module.exports = { MIGRATIONS, runMigrations };
