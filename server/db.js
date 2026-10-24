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

CREATE TABLE IF NOT EXISTS cases (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    details TEXT,
    github_url TEXT,
    demo_url TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'publicado' CHECK (status IN ('publicado', 'oculto')),
    image_path TEXT,
    image BYTEA,
    image_mime TEXT,
    image_at TIMESTAMPTZ,
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

CREATE INDEX IF NOT EXISTS projects_client_idx ON projects (client_id);
CREATE INDEX IF NOT EXISTS payments_project_idx ON payments (project_id);
`;

// Cases que já estavam na landing page; carregados uma única vez, quando a tabela está vazia
const GH = 'https://github.com/ProfWashingtonAraujo/';
const SEED_CASES = [
    ['Igreja Batista Regular Canaã', 'Site institucional', 'Site institucional para apresentar a igreja, seus ministérios, mensagens, agenda e canais de contato.', 'Projeto responsivo com identidade visual própria, navegação clara e informações organizadas para aproximar visitantes e membros da comunidade.', GH + 'ibrcanaa', 'https://ibrcanaa.vercel.app'],
    ['Vaija', 'Aplicação web', 'Aplicação web moderna publicada na Vercel, construída para entregar uma experiência rápida e responsiva.', 'Projeto front-end com foco em desempenho, boa experiência de navegação e estrutura adequada para evolução incremental.', GH + 'vaija', 'https://vaija.vercel.app'],
    ['Nexafix', 'Serviços e atendimento', 'Plataforma digital com foco em serviços, fluxo de atendimento e presença profissional na web.', 'Aplicação publicada na Vercel para demonstrar uma solução com visual profissional, fluxo claro de navegação e estrutura adequada para apresentação comercial.', GH + 'nexafix', 'https://nexafix-ten.vercel.app'],
    ['Prisma Finance', 'Gestão financeira', 'Plataforma multiloja para gestão financeira, rastreabilidade e aprovação de borderôs.', 'Sistema corporativo com acesso por unidade e função, visão administrativa centralizada e fluxos voltados ao controle financeiro diário.', null, 'https://prisma-finance.vercel.app/login'],
    ['Electoral OS', 'Gestão de campanhas', 'Sistema web para gestão de coordenadores, eleitores e locais de votação em campanhas.', 'Plataforma operacional com dados protegidos, visão estratégica em tempo real e recursos para organizar equipes e processos eleitorais.', GH + 'electoral-os', 'https://electoral-os.vercel.app/login'],
    ['ClipForge', 'Conteúdo com IA', 'Estúdio de edição com IA para transformar vídeos em cortes curtos para redes sociais.', 'Aplicação voltada à criação de conteúdo, com recursos para identificar momentos relevantes, gerar legendas e reenquadrar vídeos com agilidade.', GH + 'clipforce', 'https://clipforce.vercel.app/'],
    ['Receitê', 'Precificação', 'Fichas técnicas e precificação para confeitarias e padarias, da receita ao preço certo.', 'Sistema que calcula o custo de cada bolo, doce e pão considerando ingredientes, perdas, embalagem e custos do negócio, mostrando margem e lucro para apoiar a definição do preço de venda.', null, 'https://receitte.vercel.app']
];

async function seedCases() {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM cases');
    if (rows[0].n > 0) return;
    for (const [i, c] of SEED_CASES.entries()) {
        await pool.query(
            'INSERT INTO cases (title, category, description, details, github_url, demo_url, position, image_path) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [...c, i + 1, `src/images/project-${i + 1}.webp`]
        );
    }
}

// Cria as tabelas e, se ainda não houver usuários, o administrador definido no ambiente
async function init() {
    await pool.query(SCHEMA);
    await seedCases();

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
