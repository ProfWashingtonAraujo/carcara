// ===== HELPERS =====
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brDate = d => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysUntil = iso => Math.round((Date.parse(iso) - Date.parse(isoToday())) / 864e5);

const LABELS = {
    client: { prospect: 'Prospect', ativo: 'Ativo', inativo: 'Inativo' },
    project: { proposta: 'Proposta', em_andamento: 'Em andamento', pausado: 'Pausado', concluido: 'Concluído', cancelado: 'Cancelado' },
    stage: { diagnostico: 'Diagnóstico', planejamento: 'Planejamento', desenvolvimento: 'Desenvolvimento', evolucao: 'Evolução' },
    lead: { novo: 'Novo', contato: 'Em contato', convertido: 'Convertido', descartado: 'Descartado' }
};
const options = map => Object.entries(map).map(([value, label]) => ({ value, label }));

// ===== API =====
async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('/auth/login')) {
        showLogin();
        throw new Error(data.error || 'Sessão expirada.');
    }
    if (!res.ok) throw new Error(data.error || 'Erro inesperado. Tente novamente.');
    return data;
}

// ===== ESTADO =====
const state = { user: null, clients: [], projects: [], payments: [], leads: [], summary: null, view: 'dashboard', query: '' };

const VIEWS = {
    dashboard: { subtitle: 'Visão geral do seu negócio.', render: renderDashboard },
    clientes: { subtitle: 'Quem você atende.', render: renderClients, newLabel: 'Novo cliente', onNew: () => openForm('clients') },
    projetos: { subtitle: 'Acompanhe etapas, prazos e progresso.', render: renderProjects, newLabel: 'Novo projeto', onNew: () => openForm('projects') },
    solicitacoes: { subtitle: 'Pedidos recebidos pelo formulário do site.', render: renderLeads },
    financeiro: { subtitle: 'Recebimentos e valores a receber.', render: renderFinance, newLabel: 'Novo lançamento', onNew: () => openForm('payments') }
};

async function loadAll() {
    const [clients, projects, payments, leads, summary] = await Promise.all([
        api('/clients'), api('/projects'), api('/payments'), api('/leads'), api('/summary')
    ]);
    Object.assign(state, { clients, projects, payments, leads, summary });
    $('#loadError').hidden = true;
    renderAll();
}

function renderAll() {
    const unread = state.leads.filter(l => l.status === 'novo').length;
    const badge = $('#leadBadge');
    badge.hidden = !unread;
    badge.textContent = unread;
    renderView();
    renderCalendar();
}

// ===== TOAST =====
let toastTimer;
function toast(message, bad = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('bad', bad);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ===== LOGIN / SESSÃO =====
function showLogin() {
    state.user = null;
    $('#shell').hidden = true;
    $('#switcher').hidden = true;
    $('#login').hidden = false;
    $('#loginPassword').value = '';
}

function showApp() {
    $('#login').hidden = true;
    $('#shell').hidden = false;
    $('#switcher').hidden = false;
    $('#userName').textContent = state.user.name;
    $('#userEmail').textContent = state.user.email;
    $('#avatar').textContent = state.user.name.trim().charAt(0).toUpperCase();
    const h = new Date().getHours();
    $('#greeting').textContent = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${state.user.name.split(' ')[0]} 👋`;
}

$('#togglePass').addEventListener('click', () => {
    const input = $('#loginPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#togglePass i').className = `fas ${show ? 'fa-eye-slash' : 'fa-eye'}`;
});

$('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#loginError');
    err.hidden = true;
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    if (!email || !password) { err.textContent = 'Informe e-mail e senha.'; err.hidden = false; return; }

    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
        const { user } = await api('/auth/login', { method: 'POST', body: { email, password } });
        state.user = user;
        showApp();
        go(location.hash.slice(1), { push: false });
        await loadAll();
    } catch (error) {
        err.textContent = error.message;
        err.hidden = false;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Entrar';
    }
});

$('#logoutBtn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    showLogin();
});

// ===== NAVEGAÇÃO =====
function go(view, { push = true } = {}) {
    if (!VIEWS[view]) view = 'dashboard';
    state.view = view;
    state.query = '';
    $('#search').value = '';
    $$('.side-btn, .switcher button').forEach(b => {
        const on = b.dataset.nav === view;
        b.classList.toggle('active', on);
        on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
    });
    $('#subtitle').textContent = VIEWS[view].subtitle;
    const newBtn = $('#newBtn');
    newBtn.hidden = !VIEWS[view].onNew;
    $('#newLabel').textContent = VIEWS[view].newLabel || 'Novo';
    $('#search').closest('.search').hidden = view === 'dashboard';
    $('#main').scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    if (push && location.hash !== `#${view}`) history.pushState(null, '', `#${view}`);
    renderView();
}

function renderView() {
    if (!state.user) return;
    if (!state.summary) { $('#content').innerHTML = '<p class="empty">Carregando...</p>'; return; }
    $('#content').innerHTML = `<section class="view">${VIEWS[state.view].render()}</section>`;
    if (state.view === 'dashboard') drawChart();
}

document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) return go(nav.dataset.nav);
    const edit = e.target.closest('[data-edit]');
    if (edit) { const [kind, id] = edit.dataset.edit.split(':'); return openForm(kind, Number(id)); }
    const act = e.target.closest('[data-act]');
    if (act) return runAction(act.dataset.act, Number(act.dataset.id));
});
window.addEventListener('popstate', () => state.user && go(location.hash.slice(1), { push: false }));
$('#newBtn').addEventListener('click', () => VIEWS[state.view].onNew?.());
$('#search').addEventListener('input', e => { state.query = e.target.value.trim().toLowerCase(); renderView(); });

const matches = (...fields) => !state.query || fields.join(' ').toLowerCase().includes(state.query);
const pill = (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`;
const empty = text => `<p class="empty">${text}</p>`;

// ===== DASHBOARD =====
function renderDashboard() {
    const s = state.summary;
    if (!s) return '';
    const c = s.counts;
    const kpis = [
        { label: 'Clientes ativos', value: c.active_clients, icon: 'fa-users', color: '#2563eb', note: `${state.clients.length} no total`, go: 'clientes' },
        { label: 'Projetos em andamento', value: c.active_projects, icon: 'fa-diagram-project', color: '#ff6a1a', note: `${state.projects.length} no total`, go: 'projetos' },
        { label: 'Recebido no mês', value: money(c.received_month), icon: 'fa-sack-dollar', color: '#16a34a', note: `${money(c.pending_total)} a receber`, go: 'financeiro' },
        { label: 'Solicitações novas', value: c.new_leads, icon: 'fa-inbox', color: '#7c3aed', note: 'aguardando resposta', go: 'solicitacoes' }
    ];
    const cards = kpis.map(k => `
        <button class="card kpi" style="--c:${k.color}" data-nav="${k.go}">
            <span class="ico" style="background:${k.color}1f;color:${k.color}"><i class="fas ${k.icon}"></i></span>
            <small>${k.label}</small><strong>${esc(k.value)}</strong><p>${esc(k.note)}</p><span class="bar"></span>
        </button>`).join('');

    const overdue = c.overdue_total > 0 ? `<span class="badge bad">${money(c.overdue_total)} em atraso</span>` : '<span class="badge ok">Sem atrasos</span>';

    const leads = s.recentLeads.length
        ? s.recentLeads.map(l => `<li><button class="row-btn" data-nav="solicitacoes"><span class="mini-av">${esc(l.name.charAt(0).toUpperCase())}</span><div><strong>${esc(l.name)}</strong><span>${esc(l.service || 'Solicitação do site')}</span></div></button></li>`).join('')
        : '<li class="empty sm">Nenhuma solicitação nova.</li>';

    const deadlines = s.deadlines.length
        ? s.deadlines.slice(0, 3).map(projectMini).join('')
        : empty('Nenhum projeto com prazo definido.');

    return `
        <div class="kpis">${cards}</div>
        <div class="row-2">
            <article class="card chart-card">
                <div class="card-head"><h2>Receita recebida</h2>${overdue}</div>
                <div class="chart" id="chart"></div>
            </article>
            <article class="card">
                <div class="card-head"><h2>Solicitações novas</h2><button class="link-btn dark" data-nav="solicitacoes">ver todas</button></div>
                <ul class="list">${leads}</ul>
            </article>
        </div>
        <div class="section-head"><h2>Prazos de projetos</h2><button class="link-btn" data-nav="projetos">ver projetos</button></div>
        <div class="row-3">${deadlines}</div>`;
}

function projectMini(p) {
    const d = p.due_date ? daysUntil(p.due_date) : null;
    const when = d === null ? 'Sem prazo' : d < 0 ? `${-d} dia(s) de atraso` : d === 0 ? 'Vence hoje' : `Em ${d} dia(s)`;
    return `
        <button class="card mini-proj ${d !== null && d < 0 ? 'late' : ''}" data-edit="projects:${p.id}">
            <strong>${esc(p.title)}</strong>
            <span>${esc(p.client_name || 'Sem cliente')}</span>
            <div class="progress"><i style="width:${p.progress}%"></i></div>
            <small>${p.progress}% · ${when}</small>
        </button>`;
}

function drawChart() {
    const host = $('#chart');
    if (!host || !state.summary) return;
    const data = state.summary.months;
    const W = 560, H = 220, pl = 12, pr = 12, pt = 30, pb = 28;
    const max = Math.max(...data.map(m => m.total), 1);
    const bw = (W - pl - pr) / data.length;
    const monthName = m => new Date(`${m}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    const bars = data.map((m, i) => {
        const h = (m.total / max) * (H - pt - pb);
        const x = pl + i * bw + bw * .18, w = bw * .64, y = H - pb - h;
        const last = i === data.length - 1;
        return `<g>
            <rect class="bar-bg" x="${x}" y="${pt}" width="${w}" height="${H - pt - pb}" rx="10"/>
            <rect class="bar-fg ${last ? 'cur' : ''}" x="${x}" y="${y}" width="${w}" height="${Math.max(h, m.total ? 4 : 0)}" rx="10" tabindex="0" aria-label="${monthName(m.month)}: ${money(m.total)}"><title>${monthName(m.month)}: ${money(m.total)}</title></rect>
            ${m.total ? `<text x="${x + w / 2}" y="${y - 8}" text-anchor="middle" class="val">${money(m.total).replace(/\s/g, ' ')}</text>` : ''}
            <text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${monthName(m.month)}</text>
        </g>`;
    }).join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receita recebida nos últimos 6 meses">${bars}</svg>`;
}

// ===== CLIENTES =====
function renderClients() {
    const list = state.clients.filter(c => matches(c.name, c.company, c.email, c.city, c.phone));
    if (!list.length) return empty(state.clients.length ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda. Clique em “Novo cliente”.');
    return `<div class="grid-3">${list.map(c => `
        <button class="card client" data-edit="clients:${c.id}">
            <div class="client-top"><span class="mini-av lg">${esc(c.name.charAt(0).toUpperCase())}</span>
                <div><strong>${esc(c.name)}</strong><span>${esc(c.company || 'Pessoa física')}</span></div>
                ${pill(c.status === 'ativo' ? 'ok' : c.status === 'prospect' ? 'warn' : 'muted', LABELS.client[c.status])}</div>
            <ul class="meta">
                ${c.email ? `<li><i class="fas fa-envelope"></i>${esc(c.email)}</li>` : ''}
                ${c.phone ? `<li><i class="fas fa-phone"></i>${esc(c.phone)}</li>` : ''}
                ${c.city ? `<li><i class="fas fa-location-dot"></i>${esc(c.city)}</li>` : ''}
            </ul>
            <small>${c.projects_count} projeto(s)</small>
        </button>`).join('')}</div>`;
}

// ===== PROJETOS (quadro) =====
function renderProjects() {
    const list = state.projects.filter(p => matches(p.title, p.client_name, p.description));
    if (!state.projects.length) return empty('Nenhum projeto cadastrado ainda. Clique em “Novo projeto”.');
    const cols = Object.entries(LABELS.project).map(([status, label]) => {
        const items = list.filter(p => p.status === status);
        return `<section class="col" aria-label="${label}">
            <h3>${label} <span>${items.length}</span></h3>
            ${items.map(p => {
                const d = p.due_date ? daysUntil(p.due_date) : null;
                const late = d !== null && d < 0 && !['concluido', 'cancelado'].includes(p.status);
                return `<button class="card proj" data-edit="projects:${p.id}">
                    <strong>${esc(p.title)}</strong>
                    <span>${esc(p.client_name || 'Sem cliente')}</span>
                    <div class="progress"><i style="width:${p.progress}%"></i></div>
                    <div class="proj-foot"><small>${LABELS.stage[p.stage]}</small><small class="${late ? 'late-txt' : ''}">${p.due_date ? brDate(p.due_date) : 'Sem prazo'}</small></div>
                    <small class="price">${money(p.budget)} · ${p.progress}%</small>
                </button>`;
            }).join('') || '<p class="col-empty">—</p>'}
        </section>`;
    }).join('');
    return `<div class="board">${cols}</div>`;
}

// ===== SOLICITAÇÕES =====
function renderLeads() {
    const list = state.leads.filter(l => matches(l.name, l.email, l.service, l.message));
    if (!list.length) return empty(state.leads.length ? 'Nenhuma solicitação encontrada.' : 'Nenhuma solicitação recebida ainda. Elas chegam pelo formulário da landing page.');
    return `<div class="stack">${list.map(l => `
        <article class="card lead ${l.status === 'novo' ? 'new' : ''}">
            <div class="lead-head">
                <div><strong>${esc(l.name)}</strong><span>${esc(l.email)}${l.phone ? ` · ${esc(l.phone)}` : ''}</span></div>
                <div class="lead-side">${pill(l.status === 'novo' ? 'warn' : l.status === 'convertido' ? 'ok' : l.status === 'descartado' ? 'muted' : 'info', LABELS.lead[l.status])}<small>${new Date(l.created_at).toLocaleDateString('pt-BR')}</small></div>
            </div>
            <div class="chips">${[l.service, l.budget, l.deadline].filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('')}</div>
            <p>${esc(l.message)}</p>
            <div class="actions">
                ${l.status !== 'convertido' ? `<button class="btn sm primary" data-act="convert" data-id="${l.id}"><i class="fas fa-user-plus"></i> Converter em cliente</button>` : ''}
                ${l.status === 'novo' ? `<button class="btn sm ghost-dark" data-act="lead-contact" data-id="${l.id}">Marcar em contato</button>` : ''}
                ${!['descartado', 'convertido'].includes(l.status) ? `<button class="btn sm ghost-dark" data-act="lead-discard" data-id="${l.id}">Descartar</button>` : ''}
                <a class="btn sm ghost-dark" href="mailto:${esc(l.email)}"><i class="fas fa-envelope"></i> Responder</a>
                <button class="btn sm ghost-dark danger-txt" data-act="lead-delete" data-id="${l.id}" aria-label="Excluir solicitação"><i class="fas fa-trash"></i></button>
            </div>
        </article>`).join('')}</div>`;
}

// ===== FINANCEIRO =====
const paymentState = y => (y.paid_at ? 'pago' : y.due_date < isoToday() ? 'atrasado' : 'pendente');

function renderFinance() {
    const c = state.summary.counts;
    const totals = `<div class="kpis three">
        <article class="card kpi" style="--c:#16a34a"><span class="ico" style="background:#16a34a1f;color:#16a34a"><i class="fas fa-circle-check"></i></span><small>Recebido no mês</small><strong>${money(c.received_month)}</strong><span class="bar"></span></article>
        <article class="card kpi" style="--c:#2563eb"><span class="ico" style="background:#2563eb1f;color:#2563eb"><i class="fas fa-hourglass-half"></i></span><small>A receber</small><strong>${money(c.pending_total)}</strong><span class="bar"></span></article>
        <article class="card kpi" style="--c:#ef4444"><span class="ico" style="background:#ef44441f;color:#ef4444"><i class="fas fa-triangle-exclamation"></i></span><small>Em atraso</small><strong>${money(c.overdue_total)}</strong><span class="bar"></span></article>
    </div>`;

    const list = state.payments.filter(y => matches(y.description, y.project_title, y.client_name));
    if (!state.payments.length) return totals + empty('Nenhum lançamento ainda. Clique em “Novo lançamento” (é preciso ter um projeto).');
    const rows = list.map(y => {
        const st = paymentState(y);
        return `<tr>
            <td><strong>${esc(y.description)}</strong><span>${esc(y.project_title)}${y.client_name ? ` · ${esc(y.client_name)}` : ''}</span></td>
            <td>${brDate(y.due_date)}</td>
            <td class="num">${money(y.amount)}</td>
            <td>${pill(st === 'pago' ? 'ok' : st === 'atrasado' ? 'bad' : 'info', st === 'pago' ? `Pago em ${brDate(y.paid_at)}` : st === 'atrasado' ? 'Atrasado' : 'Pendente')}</td>
            <td class="tact">
                <button class="icon-sm" data-act="${y.paid_at ? 'unpay' : 'pay'}" data-id="${y.id}" aria-label="${y.paid_at ? 'Desfazer pagamento' : 'Marcar como pago'}" title="${y.paid_at ? 'Desfazer pagamento' : 'Marcar como pago'}"><i class="fas ${y.paid_at ? 'fa-rotate-left' : 'fa-check'}"></i></button>
                <button class="icon-sm" data-edit="payments:${y.id}" aria-label="Editar" title="Editar"><i class="fas fa-pen"></i></button>
            </td></tr>`;
    }).join('');
    return `${totals}<div class="card table-card"><div class="table-wrap"><table>
        <thead><tr><th>Lançamento</th><th>Vencimento</th><th class="num">Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty">Nenhum lançamento encontrado.</td></tr>'}</tbody></table></div></div>`;
}

// ===== AÇÕES RÁPIDAS =====
async function runAction(act, id) {
    try {
        if (act === 'pay') await api(`/payments/${id}`, { method: 'PUT', body: { paid_at: isoToday() } });
        else if (act === 'unpay') await api(`/payments/${id}`, { method: 'PUT', body: { paid_at: '' } });
        else if (act === 'lead-contact') await api(`/leads/${id}`, { method: 'PUT', body: { status: 'contato' } });
        else if (act === 'lead-discard') await api(`/leads/${id}`, { method: 'PUT', body: { status: 'descartado' } });
        else if (act === 'lead-delete') {
            if (!confirm('Excluir esta solicitação?')) return;
            await api(`/leads/${id}`, { method: 'DELETE' });
        } else if (act === 'convert') {
            await api(`/leads/${id}/convert`, { method: 'POST' });
            toast('Cliente criado a partir da solicitação.');
        }
        await loadAll();
    } catch (err) {
        toast(err.message, true);
    }
}

// ===== FORMULÁRIOS =====
const FORMS = {
    clients: {
        title: 'cliente', list: () => state.clients,
        fields: () => [
            { key: 'name', label: 'Nome', required: true, full: true },
            { key: 'company', label: 'Empresa' },
            { key: 'status', label: 'Status', type: 'select', options: options(LABELS.client), def: 'ativo', required: true },
            { key: 'email', label: 'E-mail', type: 'email' },
            { key: 'phone', label: 'Telefone', type: 'tel' },
            { key: 'city', label: 'Cidade', full: true },
            { key: 'notes', label: 'Observações', type: 'textarea', full: true }
        ]
    },
    projects: {
        title: 'projeto', list: () => state.projects,
        fields: () => [
            { key: 'title', label: 'Título', required: true, full: true },
            { key: 'client_id', label: 'Cliente', type: 'select', options: [{ value: '', label: 'Sem cliente' }, ...state.clients.map(c => ({ value: c.id, label: c.name }))] },
            { key: 'status', label: 'Status', type: 'select', options: options(LABELS.project), def: 'proposta', required: true },
            { key: 'stage', label: 'Etapa', type: 'select', options: options(LABELS.stage), def: 'diagnostico', required: true },
            { key: 'progress', label: 'Progresso (%)', type: 'number', min: 0, max: 100, step: 1, def: 0 },
            { key: 'budget', label: 'Orçamento (R$)', type: 'number', min: 0, step: '0.01', def: 0 },
            { key: 'start_date', label: 'Início', type: 'date' },
            { key: 'due_date', label: 'Prazo', type: 'date' },
            { key: 'description', label: 'Descrição', type: 'textarea', full: true }
        ]
    },
    payments: {
        title: 'lançamento', list: () => state.payments,
        fields: () => [
            { key: 'project_id', label: 'Projeto', type: 'select', required: true, full: true, options: [{ value: '', label: 'Selecione um projeto' }, ...state.projects.map(p => ({ value: p.id, label: `${p.title}${p.client_name ? ` · ${p.client_name}` : ''}` }))] },
            { key: 'description', label: 'Descrição', required: true, full: true, placeholder: 'Ex.: Entrada 50%' },
            { key: 'amount', label: 'Valor (R$)', type: 'number', min: 0, step: '0.01', required: true },
            { key: 'due_date', label: 'Vencimento', type: 'date', required: true },
            { key: 'paid_at', label: 'Pago em (se já recebido)', type: 'date', full: true }
        ]
    }
};

const dlg = $('#formDialog');
let editing = null; // { kind, id }

function fieldHtml(f, value) {
    const id = `f_${f.key}`;
    const v = value ?? f.def ?? '';
    const req = f.required ? 'required' : '';
    let control;
    if (f.type === 'select') {
        control = `<select id="${id}" name="${f.key}" ${req}>${f.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
        control = `<textarea id="${id}" name="${f.key}" rows="3">${esc(v)}</textarea>`;
    } else {
        const extra = ['min', 'max', 'step'].filter(a => f[a] !== undefined).map(a => `${a}="${f[a]}"`).join(' ');
        control = `<input id="${id}" name="${f.key}" type="${f.type || 'text'}" value="${esc(v)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${extra} ${req}>`;
    }
    return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${f.label}${f.required ? '' : ' <em>(opcional)</em>'}</label>${control}</div>`;
}

function openForm(kind, id = null) {
    const cfg = FORMS[kind];
    if (kind === 'payments' && !state.projects.length) return toast('Cadastre um projeto antes de lançar valores.', true);
    const record = id ? cfg.list().find(r => r.id === id) : null;
    editing = { kind, id };
    $('#formTitle').textContent = `${record ? 'Editar' : 'Novo'} ${cfg.title}`;
    $('#formFields').innerHTML = cfg.fields().map(f => fieldHtml(f, record?.[f.key])).join('');
    $('#formError').hidden = true;
    $('#formDelete').hidden = !record;
    dlg.showModal();
    $('#formFields input, #formFields select')?.focus();
}

const closeForm = () => dlg.close();
$('#formClose').addEventListener('click', closeForm);
$('#formCancel').addEventListener('click', closeForm);
dlg.addEventListener('click', e => { if (e.target === dlg) closeForm(); });

$('#entityForm').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#formError');
    err.hidden = true;
    const body = {};
    for (const el of $$('#formFields [name]')) {
        if (el.required && !el.value.trim()) { err.textContent = `Preencha o campo "${el.labels[0].textContent.replace('(opcional)', '').trim()}".`; err.hidden = false; return el.focus(); }
        body[el.name] = el.value;
    }
    const btn = $('#formSave');
    btn.disabled = true;
    try {
        const path = `/${editing.kind}${editing.id ? `/${editing.id}` : ''}`;
        await api(path, { method: editing.id ? 'PUT' : 'POST', body });
        closeForm();
        toast('Salvo com sucesso.');
        await loadAll();
    } catch (error) {
        err.textContent = error.message;
        err.hidden = false;
    } finally {
        btn.disabled = false;
    }
});

$('#formDelete').addEventListener('click', async () => {
    const what = { clients: 'este cliente (os projetos dele ficam sem cliente)', projects: 'este projeto e todos os seus lançamentos financeiros', payments: 'este lançamento' }[editing.kind];
    if (!confirm(`Excluir ${what}? Esta ação não pode ser desfeita.`)) return;
    try {
        await api(`/${editing.kind}/${editing.id}`, { method: 'DELETE' });
        closeForm();
        toast('Excluído.');
        await loadAll();
    } catch (error) {
        $('#formError').textContent = error.message;
        $('#formError').hidden = false;
    }
});

// ===== CALENDÁRIO / AGENDA =====
const cal = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), selected: null };

function calendarEvents() {
    const ev = {};
    const add = (date, item) => { if (date) (ev[date] ||= []).push(item); };
    state.projects.filter(p => ['proposta', 'em_andamento', 'pausado'].includes(p.status)).forEach(p => add(p.due_date, { type: 'proj', text: p.title, sub: p.client_name || 'Prazo do projeto', id: p.id, kind: 'projects' }));
    state.payments.filter(y => !y.paid_at).forEach(y => add(y.due_date, { type: 'pay', text: `${money(y.amount)} · ${y.description}`, sub: y.client_name || y.project_title, id: y.id, kind: 'payments' }));
    return ev;
}

function renderCalendar() {
    if (!state.user) return;
    const ev = calendarEvents();
    const today = isoToday();
    const { month } = cal;
    $('#calTitle').textContent = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(' de ', ' · ');

    let html = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => `<span class="dow">${d}</span>`).join('') + '<span></span>'.repeat(month.getDay());
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let n = 1; n <= days; n++) {
        const iso = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
        const items = ev[iso] || [];
        const dots = ['proj', 'pay'].filter(t => items.some(i => i.type === t)).map(t => `<i class="d-${t}"></i>`).join('');
        html += `<button class="${iso === today ? 'today' : ''} ${cal.selected === iso ? 'sel' : ''}" data-day="${iso}" aria-label="${brDate(iso)}${items.length ? `, ${items.length} item(ns)` : ''}">${n}<span class="dots">${dots}</span></button>`;
    }
    $('#calGrid').innerHTML = html;

    const upcoming = cal.selected
        ? (ev[cal.selected] || []).map(i => ({ ...i, date: cal.selected }))
        : Object.entries(ev).filter(([d]) => d >= today).sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, items]) => items.map(i => ({ ...i, date }))).slice(0, 6);
    $('#agendaTitle').textContent = cal.selected ? `Em ${brDate(cal.selected)}` : 'Próximos vencimentos';
    $('#agenda').innerHTML = upcoming.length
        ? upcoming.map(i => `<li><button class="row-btn light" data-edit="${i.kind}:${i.id}"><span class="a-dot d-${i.type}"></span><div><strong>${esc(i.text)}</strong><span>${brDate(i.date)} · ${esc(i.sub)}</span></div></button></li>`).join('')
        : '<li class="agenda-empty">Nada agendado.</li>';
}

$('#calPrev').addEventListener('click', () => { cal.month = new Date(cal.month.getFullYear(), cal.month.getMonth() - 1, 1); renderCalendar(); });
$('#calNext').addEventListener('click', () => { cal.month = new Date(cal.month.getFullYear(), cal.month.getMonth() + 1, 1); renderCalendar(); });
$('#calGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    cal.selected = cal.selected === b.dataset.day ? null : b.dataset.day;
    renderCalendar();
});

// ===== INICIALIZAÇÃO =====
(async function init() {
    try {
        const { user } = await api('/auth/me');
        state.user = user;
        showApp();
        go(location.hash.slice(1), { push: false });
        await loadAll();
    } catch {
        if (state.user) {
            $('#loadError').textContent = 'Não foi possível carregar os dados. Verifique a conexão e recarregue a página.';
            $('#loadError').hidden = false;
        } else {
            showLogin();
        }
    }
})();
