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

CREATE INDEX IF NOT EXISTS projects_client_idx ON projects (client_id);
CREATE INDEX IF NOT EXISTS payments_project_idx ON payments (project_id);
`;

// Cria as tabelas e, se ainda não houver usuários, o administrador definido no ambiente
async function init() {
    await pool.query(SCHEMA);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n > 0) return;

    const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.warn('Nenhum usuário cadastrado e ADMIN_EMAIL/ADMIN_PASSWORD não definidos: o login ficará indisponível.');
        return;
    }
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)', [ADMIN_NAME || 'Administrador', ADMIN_EMAIL.toLowerCase(), hash]);
    console.log(`Usuário administrador criado: ${ADMIN_EMAIL}`);
}

module.exports = { pool, init };
