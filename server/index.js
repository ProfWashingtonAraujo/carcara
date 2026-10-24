const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* sem .env: usa o ambiente */ }

const { pool, init } = require('./db');

const PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('JWT_SECRET precisa ter ao menos 32 caracteres.');
    process.exit(1);
}

const COOKIE = 'carcara_session';
const SESSION_DAYS = 7;
const ROOT = path.join(__dirname, '..');

const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? (PROD ? 2 : 0)));
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https://images.unsplash.com'],
            frameSrc: ['https://www.google.com'],
            connectSrc: ["'self'", 'https://formsubmit.co'],
            formAction: ["'self'", 'https://formsubmit.co'],
            upgradeInsecureRequests: null
        }
    }
}));
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());

// ===== Helpers =====
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

const idParam = req => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'ID inválido');
    return id;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Valida e normaliza o corpo conforme o esquema do recurso
function parseBody(schema, body, { partial = false } = {}) {
    const out = {};
    for (const [key, rule] of Object.entries(schema)) {
        let v = body?.[key];
        const missing = v === undefined || v === null || v === '';

        if (missing) {
            if (rule.required && !partial) throw new HttpError(400, `Campo obrigatório: ${rule.label || key}`);
            if (body && key in body && !rule.required && (rule.nullable || !(rule.enum || rule.type === 'int' || rule.type === 'money'))) out[key] = null;
            continue;
        }

        switch (rule.type) {
            case 'int':
                v = Number(v);
                if (!Number.isInteger(v) || v < (rule.min ?? -Infinity) || v > (rule.max ?? Infinity)) throw new HttpError(400, `Valor inválido: ${rule.label || key}`);
                break;
            case 'money':
                v = Number(v);
                if (!Number.isFinite(v) || v < 0 || v > 1e9) throw new HttpError(400, `Valor inválido: ${rule.label || key}`);
                break;
            case 'date':
                if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `Data inválida: ${rule.label || key}`);
                break;
            case 'email':
                if (typeof v !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 200) throw new HttpError(400, 'E-mail inválido');
                v = v.trim().toLowerCase();
                break;
            default:
                if (typeof v !== 'string') throw new HttpError(400, `Valor inválido: ${rule.label || key}`);
                v = v.trim();
                if (v.length > (rule.max || 500)) throw new HttpError(400, `Texto muito longo: ${rule.label || key}`);
                if (rule.required && !v) throw new HttpError(400, `Campo obrigatório: ${rule.label || key}`);
                if (rule.enum && !rule.enum.includes(v)) throw new HttpError(400, `Valor inválido: ${rule.label || key}`);
        }
        out[key] = v;
    }
    return out;
}

// Verificação de saúde usada pelo Render
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ===== Autenticação =====
async function requireAuth(req, res, next) {
    try {
        const payload = jwt.verify(req.cookies[COOKIE], JWT_SECRET);
        // confere no banco: usuário excluído perde o acesso na hora
        const { rows } = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [payload.sub]);
        if (!rows[0]) throw new Error('usuário inexistente');
        req.user = rows[0];
        next();
    } catch {
        res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
    }
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde alguns minutos.' } });
const leadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas solicitações. Tente novamente mais tarde.' } });

// Hash falso para igualar o tempo de resposta quando o e-mail não existe
const DUMMY_HASH = bcrypt.hashSync('invalido', 12);

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const { rows } = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'E-mail ou senha incorretos.');

    const token = jwt.sign({ sub: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
    res.cookie(COOKIE, token, { httpOnly: true, secure: PROD, sameSite: 'lax', maxAge: SESSION_DAYS * 864e5, path: '/' });
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
}));

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email } }));

// ===== Solicitações do site (público) =====
const LEAD_SCHEMA = {
    name: { required: true, label: 'Nome', max: 120 },
    email: { required: true, type: 'email', label: 'E-mail' },
    phone: { max: 40, label: 'Telefone' },
    service: { max: 80, label: 'Serviço' },
    budget: { max: 80, label: 'Investimento' },
    deadline: { max: 80, label: 'Prazo' },
    message: { required: true, max: 3000, label: 'Mensagem' }
};

app.post('/api/leads', leadLimiter, wrap(async (req, res) => {
    // campo-isca: robôs preenchem, pessoas não
    if (req.body?._honey) return res.status(201).json({ ok: true });
    const d = parseBody(LEAD_SCHEMA, req.body);
    await pool.query(
        'INSERT INTO leads (name, email, phone, service, budget, deadline, message) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [d.name, d.email, d.phone ?? null, d.service ?? null, d.budget ?? null, d.deadline ?? null, d.message]
    );
    res.status(201).json({ ok: true });
}));

// ===== CRUD autenticado =====
const api = express.Router();
api.use(requireAuth);

const STATUS_CLIENT = ['prospect', 'ativo', 'inativo'];
const STATUS_PROJECT = ['proposta', 'em_andamento', 'pausado', 'concluido', 'cancelado'];
const STAGES = ['diagnostico', 'planejamento', 'desenvolvimento', 'evolucao'];
const STATUS_LEAD = ['novo', 'contato', 'convertido', 'descartado'];

const RESOURCES = {
    clients: {
        schema: {
            name: { required: true, label: 'Nome', max: 120 },
            company: { max: 120, label: 'Empresa' },
            email: { type: 'email', label: 'E-mail' },
            phone: { max: 40, label: 'Telefone' },
            city: { max: 80, label: 'Cidade' },
            status: { enum: STATUS_CLIENT, label: 'Status' },
            notes: { max: 3000, label: 'Observações' }
        },
        select: `SELECT c.*, (SELECT count(*)::int FROM projects p WHERE p.client_id = c.id) AS projects_count FROM clients c`,
        one: 'WHERE c.id = $1',
        order: 'ORDER BY c.created_at DESC'
    },
    projects: {
        schema: {
            client_id: { type: 'int', min: 1, nullable: true, label: 'Cliente' },
            title: { required: true, label: 'Título', max: 160 },
            description: { max: 3000, label: 'Descrição' },
            status: { enum: STATUS_PROJECT, label: 'Status' },
            stage: { enum: STAGES, label: 'Etapa' },
            progress: { type: 'int', min: 0, max: 100, label: 'Progresso' },
            budget: { type: 'money', label: 'Orçamento' },
            start_date: { type: 'date', label: 'Início' },
            due_date: { type: 'date', label: 'Prazo' }
        },
        select: `SELECT p.*, c.name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id`,
        one: 'WHERE p.id = $1',
        order: 'ORDER BY p.created_at DESC'
    },
    payments: {
        schema: {
            project_id: { required: true, type: 'int', min: 1, label: 'Projeto' },
            description: { required: true, label: 'Descrição', max: 160 },
            amount: { required: true, type: 'money', label: 'Valor' },
            due_date: { required: true, type: 'date', label: 'Vencimento' },
            paid_at: { type: 'date', label: 'Pago em' }
        },
        select: `SELECT y.*, p.title AS project_title, c.name AS client_name
                 FROM payments y JOIN projects p ON p.id = y.project_id LEFT JOIN clients c ON c.id = p.client_id`,
        one: 'WHERE y.id = $1',
        order: 'ORDER BY (y.paid_at IS NOT NULL), y.due_date ASC'
    },
    leads: {
        schema: { status: { enum: STATUS_LEAD, label: 'Status' } },
        select: 'SELECT l.* FROM leads l',
        one: 'WHERE l.id = $1',
        order: 'ORDER BY l.created_at DESC',
        noCreate: true
    }
};

// ===== Usuários do painel =====
const USER_SCHEMA = {
    name: { required: true, label: 'Nome', max: 120 },
    email: { required: true, type: 'email', label: 'E-mail' }
};

function parsePassword(value, { required }) {
    if (value === undefined || value === null || value === '') {
        if (required) throw new HttpError(400, 'Informe a senha.');
        return null;
    }
    if (typeof value !== 'string' || value.length < 10) throw new HttpError(400, 'A senha deve ter ao menos 10 caracteres.');
    if (Buffer.byteLength(value) > 72) throw new HttpError(400, 'A senha pode ter no máximo 72 caracteres.');
    return value;
}

const USER_COLS = 'id, name, email, created_at';

api.get('/users', wrap(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users ORDER BY created_at`);
    res.json(rows);
}));

api.post('/users', wrap(async (req, res) => {
    const data = parseBody(USER_SCHEMA, req.body);
    const password = parsePassword(req.body?.password, { required: true });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING ${USER_COLS}`,
        [data.name, data.email, hash]
    );
    res.status(201).json(rows[0]);
}));

api.put('/users/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const data = parseBody(USER_SCHEMA, req.body, { partial: true });
    const password = parsePassword(req.body?.password, { required: false });
    const sets = [], values = [];
    for (const [k, v] of Object.entries(data)) { values.push(v); sets.push(`${k} = $${values.length}`); }
    if (password) { values.push(await bcrypt.hash(password, 12)); sets.push(`password_hash = $${values.length}`); }
    if (!sets.length) throw new HttpError(400, 'Nada para atualizar');
    values.push(id);
    const { rows } = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${USER_COLS}`, values);
    if (!rows[0]) throw new HttpError(404, 'Usuário não encontrado');
    res.json(rows[0]);
}));

api.delete('/users/:id', wrap(async (req, res) => {
    const id = idParam(req);
    if (id === req.user.id) throw new HttpError(400, 'Você não pode excluir o próprio usuário.');
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'Usuário não encontrado');
    res.json({ ok: true });
}));

const TABLES = { clients: 'clients', projects: 'projects', payments: 'payments', leads: 'leads' };
for (const [name, r] of Object.entries(RESOURCES)) {
    const table = TABLES[name];

    api.get(`/${name}`, wrap(async (req, res) => {
        const { rows } = await pool.query(`${r.select} ${r.order}`);
        res.json(rows);
    }));

    if (!r.noCreate) {
        api.post(`/${name}`, wrap(async (req, res) => {
            const data = parseBody(r.schema, req.body);
            const cols = Object.keys(data).filter(k => data[k] !== null);
            const { rows } = await pool.query(
                `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
                cols.map(k => data[k])
            );
            const created = await pool.query(`${r.select} ${r.one}`, [rows[0].id]);
            res.status(201).json(created.rows[0]);
        }));
    }

    api.put(`/${name}/:id`, wrap(async (req, res) => {
        const id = idParam(req);
        const data = parseBody(r.schema, req.body, { partial: true });
        const keys = Object.keys(data);
        if (!keys.length) throw new HttpError(400, 'Nada para atualizar');
        const { rowCount } = await pool.query(
            `UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(',')} WHERE id = $${keys.length + 1}`,
            [...keys.map(k => data[k]), id]
        );
        if (!rowCount) throw new HttpError(404, 'Registro não encontrado');
        const updated = await pool.query(`${r.select} ${r.one}`, [id]);
        res.json(updated.rows[0]);
    }));

    api.delete(`/${name}/:id`, wrap(async (req, res) => {
        const { rowCount } = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [idParam(req)]);
        if (!rowCount) throw new HttpError(404, 'Registro não encontrado');
        res.json({ ok: true });
    }));
}

// Converte uma solicitação em cliente (e marca como convertida)
api.post('/leads/:id/convert', wrap(async (req, res) => {
    const id = idParam(req);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [id]);
        const lead = rows[0];
        if (!lead) throw new HttpError(404, 'Solicitação não encontrada');
        if (lead.status === 'convertido') throw new HttpError(409, 'Solicitação já convertida');
        const created = await client.query(
            `INSERT INTO clients (name, email, phone, status, notes) VALUES ($1,$2,$3,'prospect',$4) RETURNING id`,
            [lead.name, lead.email, lead.phone, [lead.service && `Serviço: ${lead.service}`, lead.budget && `Investimento: ${lead.budget}`, lead.deadline && `Prazo: ${lead.deadline}`, lead.message].filter(Boolean).join('\n')]
        );
        await client.query(`UPDATE leads SET status = 'convertido' WHERE id = $1`, [id]);
        await client.query('COMMIT');
        res.status(201).json({ client_id: created.rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}));

// Resumo para a dashboard
api.get('/summary', wrap(async (req, res) => {
    const q = sql => pool.query(sql).then(r => r.rows);
    const [[counts], months, deadlines, recentLeads, byStatus] = await Promise.all([
        q(`SELECT
              (SELECT count(*)::int FROM clients WHERE status = 'ativo') AS active_clients,
              (SELECT count(*)::int FROM projects WHERE status = 'em_andamento') AS active_projects,
              (SELECT count(*)::int FROM leads WHERE status = 'novo') AS new_leads,
              COALESCE((SELECT sum(amount) FROM payments WHERE paid_at >= date_trunc('month', CURRENT_DATE)), 0)::float AS received_month,
              COALESCE((SELECT sum(amount) FROM payments WHERE paid_at IS NULL), 0)::float AS pending_total,
              COALESCE((SELECT sum(amount) FROM payments WHERE paid_at IS NULL AND due_date < CURRENT_DATE), 0)::float AS overdue_total`),
        q(`SELECT to_char(m, 'YYYY-MM') AS month, COALESCE(sum(y.amount), 0)::float AS total
           FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') m
           LEFT JOIN payments y ON date_trunc('month', y.paid_at) = m
           GROUP BY m ORDER BY m`),
        q(`SELECT p.id, p.title, p.due_date, p.progress, p.status, c.name AS client_name
           FROM projects p LEFT JOIN clients c ON c.id = p.client_id
           WHERE p.due_date IS NOT NULL AND p.status IN ('proposta', 'em_andamento', 'pausado')
           ORDER BY p.due_date ASC LIMIT 6`),
        q(`SELECT id, name, service, created_at FROM leads WHERE status = 'novo' ORDER BY created_at DESC LIMIT 4`),
        q(`SELECT status, count(*)::int AS n FROM projects GROUP BY status`)
    ]);
    res.json({ counts, months, deadlines, recentLeads, byStatus });
}));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

// ===== Arquivos estáticos (uso local; em produção a Vercel serve o front) =====
for (const file of ['index.html', 'style.css', 'script.js']) {
    app.get(file === 'index.html' ? '/' : `/${file}`, (req, res) => res.sendFile(path.join(ROOT, file)));
}
app.use('/src', express.static(path.join(ROOT, 'src')));
app.use('/app', express.static(path.join(ROOT, 'app')));

// ===== Erros =====
app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe um usuário com esse e-mail.' });
    // violações de chave estrangeira (ex.: cliente inexistente)
    if (err.code === '23503') return res.status(400).json({ error: 'Registro relacionado não existe' });
    console.error(err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3000;
init().then(() => {
    app.listen(PORT, () => console.log(`Carcará rodando em http://localhost:${PORT}`));
}).catch(err => {
    console.error('Falha ao iniciar o banco de dados:', err.message);
    process.exit(1);
});
