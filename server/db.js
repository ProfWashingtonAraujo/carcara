const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// numeric -> number, date -> 'YYYY-MM-DD' (sem fuso horário)
types.setTypeParser(1700, parseFloat);
types.setTypeParser(1082, value => value);

if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não definida. Copie server/.env.example para server/.env.');
    process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 15000 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT,
    email TEXT,
    phone TEXT,
    city TEXT,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('prospect', 'ativo', 'inativo')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'proposta' CHECK (status IN ('proposta', 'em_andamento', 'pausado', 'concluido', 'cancelado')),
    stage TEXT NOT NULL DEFAULT 'diagnostico' CHECK (stage IN ('diagnostico', 'planejamento', 'desenvolvimento', 'evolucao')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    budget NUMERIC(12, 2) NOT NULL DEFAULT 0,
    start_date DATE,
    due_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    due_date DATE NOT NULL,
    paid_at DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    service TEXT,
    budget TEXT,
    deadline TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'contato', 'convertido', 'descartado')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- análise automática (python -m carcara triage)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_category TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_complexity TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_priority TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_next_steps TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_reply TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_at TIMESTAMPTZ;

-- depoimentos: nascem de um convite (status 'convite', só o hash do link fica guardado) ou de um cadastro manual;
-- só vão ao site depois de aprovados no painel
CREATE TABLE IF NOT EXISTS testimonials (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    author_role TEXT,
    body TEXT,
    source TEXT NOT NULL DEFAULT 'convite' CHECK (source IN ('convite', 'manual')),
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('convite', 'pendente', 'aprovado', 'rejeitado')),
    consent_at TIMESTAMPTZ,
    consent_note TEXT,
    invite_hash TEXT UNIQUE,
    invite_expires_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status IN ('convite', 'rejeitado') OR (body IS NOT NULL AND consent_at IS NOT NULL))
);

ALTER TABLE testimonials ADD COLUMN IF NOT EXISTS author_photo TEXT;

CREATE INDEX IF NOT EXISTS projects_client_idx ON projects (client_id);
CREATE INDEX IF NOT EXISTS payments_project_idx ON payments (project_id);
`;

const TABLES = ['users', 'clients', 'projects', 'payments', 'leads', 'testimonials'];
const quoteIdent = name => `"${name.replace(/"/g, '""')}"`;

// Row Level Security: só o papel que a API usa enxerga linhas. Qualquer outro papel (ex.: o Data API
// do Neon, ou uma credencial vazada de outro serviço) cai na regra padrão de negar tudo.
async function secureTables() {
    const { rows: [{ me }] } = await pool.query('SELECT current_user AS me');
    const role = quoteIdent(me);
    const policy = `app_access_${require('crypto').createHash('md5').update(me).digest('hex').slice(0, 8)}`;
    for (const table of TABLES) {
        await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await pool.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        const { rowCount } = await pool.query('SELECT 1 FROM pg_policies WHERE tablename = $1 AND policyname = $2', [table, policy]);
        if (!rowCount) await pool.query(`CREATE POLICY ${policy} ON ${table} FOR ALL TO ${role} USING (true) WITH CHECK (true)`);
    }
}

// Cria as tabelas e, se ainda não houver usuários, o administrador definido no ambiente
async function init() {
    await pool.query(SCHEMA);
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0');
    // quem já existia tinha acesso total: vira admin; novos usuários entram como membro
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'membro'))`);
    await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'membro'`);

    await secureTables();

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n > 0) return;

    const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.warn('Nenhum usuário cadastrado e ADMIN_EMAIL/ADMIN_PASSWORD não definidos: o login ficará indisponível.');
        return;
    }
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`, [ADMIN_NAME || 'Administrador', ADMIN_EMAIL.toLowerCase(), hash]);
    console.log(`Usuário administrador criado: ${ADMIN_EMAIL}`);
}

module.exports = { pool, init };
