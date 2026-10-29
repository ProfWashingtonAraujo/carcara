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
const SEM_CONEXAO = 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.';

async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
    }).catch(() => { throw new Error(SEM_CONEXAO); });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('/auth/login')) {
        showLogin();
        throw new Error(data.error || 'Sessão expirada.');
    }
    if (!res.ok) throw new Error(data.error || 'Erro inesperado. Tente novamente.');
    return data;
}

// ===== FOTO DE PERFIL =====
function setAvatar(el, user) {
    el.style.backgroundImage = user.avatar ? `url("${user.avatar}")` : '';
    el.textContent = user.avatar ? '' : user.name.trim().charAt(0).toUpperCase();
}

// recorta o centro em quadrado e reduz para 256 px, para a imagem ficar leve no banco
function resizeImage(file, size = 256) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const side = Math.min(img.width, img.height);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
        img.src = url;
    });
}

async function saveAvatar(avatar) {
    const data = await api('/me/avatar', { method: 'PUT', body: { avatar } });
    state.user.avatar = data.avatar;
    const me = state.users.find(u => u.id === state.user.id);
    if (me) me.avatar = data.avatar;
    setAvatar($('#avatar'), state.user);
    $('#avatarRemove').hidden = !state.user.avatar;
    if (state.view === 'usuarios') renderView();
}

// ===== ESTADO =====
const isAdmin = () => state.user?.role === 'admin';
const state = { user: null, clients: [], projects: [], payments: [], leads: [], testimonials: [], users: [], summary: null, view: 'dashboard', query: '', exportMonth: isoToday().slice(0, 7) };

const VIEWS = {
    dashboard: { subtitle: 'Visão geral do seu negócio.', render: renderDashboard },
    clientes: { subtitle: 'Quem você atende.', render: renderClients, newLabel: 'Novo cliente', onNew: () => openForm('clients') },
    projetos: { subtitle: 'Acompanhe etapas, prazos e progresso.', render: renderProjects, newLabel: 'Novo projeto', onNew: () => openForm('projects') },
    solicitacoes: { subtitle: 'Pedidos recebidos pelo formulário do site.', render: renderLeads },
    financeiro: { subtitle: 'Recebimentos e valores a receber.', render: renderFinance, newLabel: 'Novo lançamento', onNew: () => openForm('payments') },
    depoimentos: { subtitle: 'Depoimentos reais de clientes: só vão ao site depois de aprovados por você.', render: renderTestimonials, newLabel: 'Registrar depoimento', onNew: () => openForm('testimonials') },
    usuarios: { subtitle: 'Quem tem acesso a este painel.', render: renderUsers, newLabel: 'Novo usuário', onNew: () => openForm('users') }
};

async function loadAll() {
    const [clients, projects, payments, leads, users, summary, testimonials] = await Promise.all([
        api('/clients'), api('/projects'), api('/payments'), api('/leads'), api('/users'), api('/summary'), api('/testimonials')
    ]);
    Object.assign(state, { clients, projects, payments, leads, users, summary, testimonials });
    $('#loadError').hidden = true;
    renderAll();
}

function renderAll() {
    const unread = state.leads.filter(l => l.status === 'novo').length;
    const badge = $('#leadBadge');
    badge.hidden = !unread;
    badge.textContent = unread;
    const waiting = state.testimonials.filter(t => t.status === 'pendente').length;
    const tBadge = $('#testimonialBadge');
    tBadge.hidden = !waiting;
    tBadge.textContent = waiting;
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
    setAvatar($('#avatar'), state.user);
    $('#avatarRemove').hidden = !state.user.avatar;
    const h = new Date().getHours();
    $('#greeting').textContent = `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}, ${state.user.name.split(' ')[0]}`;
}

$('#avatar').addEventListener('click', () => $('#avatarFile').click());
$('#avatarFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
        await saveAvatar(await resizeImage(file));
        toast('Foto de perfil atualizada.');
    } catch (err) {
        toast(err.message, true);
    }
});
$('#avatarRemove').addEventListener('click', async () => {
    try {
        await saveAvatar(null);
        toast('Foto removida.');
    } catch (err) {
        toast(err.message, true);
    }
});

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
    newBtn.hidden = !VIEWS[view].onNew || (['usuarios', 'depoimentos'].includes(view) && !isAdmin());
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
    const eye = e.target.closest('[data-eye]');
    if (eye) {
        const input = eye.parentElement.querySelector('input');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        eye.setAttribute('aria-pressed', show);
        eye.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
        eye.firstElementChild.className = `fas ${show ? 'fa-eye-slash' : 'fa-eye'}`;
        return;
    }
    const exp = e.target.closest('[data-export]');
    if (exp) { const [report, format] = exp.dataset.export.split(':'); return downloadExport(report, format, exp); }
    const nav = e.target.closest('[data-nav]');
    if (nav) return go(nav.dataset.nav);
    const edit = e.target.closest('[data-edit]');
    if (edit) { const [kind, id] = edit.dataset.edit.split(':'); return openForm(kind, Number(id)); }
    const act = e.target.closest('[data-act]');
    if (act) return runAction(act.dataset.act, Number(act.dataset.id));
});
document.addEventListener('change', e => { if (e.target.matches('[data-export-month]') && e.target.value) state.exportMonth = e.target.value; });
window.addEventListener('popstate', () => state.user && go(location.hash.slice(1), { push: false }));
$('#newBtn').addEventListener('click', () => VIEWS[state.view].onNew?.());
$('#search').addEventListener('input', e => { state.query = e.target.value.trim().toLowerCase(); renderView(); });

const matches = (...fields) => !state.query || fields.join(' ').toLowerCase().includes(state.query);
const pill = (cls, text) => `<span class="badge ${cls}">${esc(text)}</span>`;
const empty = text => `<p class="empty">${text}</p>`;

// ===== EXPORTAÇÃO (Excel / PDF) =====
function exportBar(report, label = 'Exportar') {
    const btn = (format, icon, name) => `<button class="btn sm ghost" data-export="${report}:${format}"><i class="fas ${icon}"></i> ${name}</button>`;
    return `<div class="export-bar"><span>${label}</span>
        <input type="month" data-export-month value="${state.exportMonth}" aria-label="Mês do relatório">
        ${btn('xlsx', 'fa-file-excel', 'Excel')}${btn('pdf', 'fa-file-pdf', 'PDF')}</div>`;
}

async function downloadExport(report, format, button) {
    const icon = button.querySelector('i');
    const original = icon.className;
    button.disabled = true;
    icon.className = 'fas fa-spinner fa-spin';
    try {
        const res = await fetch(`/api/export/${report}?format=${format}&month=${encodeURIComponent(state.exportMonth)}`, { credentials: 'same-origin' }).catch(() => { throw new Error(SEM_CONEXAO); });
        if (res.status === 401) { showLogin(); return; }
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Não foi possível gerar o arquivo.');
        const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `relatorio.${format}`;
        const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    } catch (err) {
        toast(err.message, true);
    } finally {
        button.disabled = false;
        icon.className = original;
    }
}

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
        ${exportBar('resumo', 'Relatório do mês')}
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
    const W = 560, H = 230, pl = 24, pr = 24, pt = 38, pb = 30;
    const max = Math.max(...data.map(m => m.total), 1);
    const X = i => pl + (i / (data.length - 1)) * (W - pl - pr);
    const Y = v => pt + (1 - v / max) * (H - pt - pb);
    const P = data.map((m, i) => [X(i), Y(m.total)]);
    const monthName = m => new Date(`${m}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    const base = Y(0), top = Y(max);

    // curva suave (Catmull-Rom -> Bézier), sem passar abaixo de zero nem acima do máximo
    const clamp = y => Math.min(Math.max(y, top), base);
    let d = `M${P[0][0]},${P[0][1]}`;
    for (let i = 0; i < P.length - 1; i++) {
        const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
        d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
    }

    const grid = [0, .5, 1].map(f => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(max * f)}" y2="${Y(max * f)}"/>`).join('');
    const labels = data.map((m, i) => `<text x="${P[i][0]}" y="${H - 8}" text-anchor="middle">${monthName(m.month)}</text>`).join('');
    const values = data.map((m, i) => (m.total ? `<text class="val" x="${P[i][0]}" y="${P[i][1] - 14}" text-anchor="middle">${money(m.total).replace(/\s/g, ' ')}</text>` : '')).join('');
    const dots = data.map((m, i) => `<circle class="dot ${i === data.length - 1 ? 'cur' : ''}" r="${i === data.length - 1 ? 6 : 5}" cx="${P[i][0]}" cy="${P[i][1]}" tabindex="0" aria-label="${monthName(m.month)}: ${money(m.total)}"><title>${monthName(m.month)}: ${money(m.total)}</title></circle>`).join('');

    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receita recebida nos últimos 6 meses">
        <defs><linearGradient id="revG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a1a" stop-opacity=".3"/><stop offset="1" stop-color="#ff6a1a" stop-opacity="0"/></linearGradient></defs>
        ${grid}
        <path class="area" d="${d} L${P[P.length - 1][0]},${base} L${P[0][0]},${base} Z"/>
        <path class="line" pathLength="1" d="${d}"/>
        ${values}${labels}${dots}
    </svg>`;
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

// ===== DEPOIMENTOS =====
const TESTIMONIAL = {
    status: { convite: 'Aguardando o cliente', pendente: 'Aguardando aprovação', aprovado: 'No ar', rejeitado: 'Rejeitado' },
    tone: { convite: 'info', pendente: 'warn', aprovado: 'ok', rejeitado: 'muted' }
};

function renderTestimonials() {
    const list = state.testimonials.filter(t => matches(t.author_name, t.author_role, t.body, t.client_name));
    const head = `<div class="actions" style="margin-bottom:14px"><button class="btn sm primary" data-act="invite"><i class="fas fa-link"></i> Gerar link de convite</button></div>`;
    const note = `<p class="hint">Só depoimentos aprovados aparecem no site; sem nenhum, a seção fica oculta. O link de convite vale 30 dias, serve para um único envio e só é exibido na hora em que é gerado.</p>`;
    if (!list.length) return head + empty(state.testimonials.length ? 'Nenhum depoimento encontrado.' : 'Nenhum depoimento ainda. Gere um link de convite e envie ao cliente.') + note;
    return `${head}<div class="stack">${list.map(t => `
        <article class="card lead ${t.status === 'pendente' ? 'new' : ''}">
            <div class="lead-head">
                <div><strong>${esc(t.author_name)}</strong><span>${esc([t.author_role, t.client_name && `Cliente: ${t.client_name}`].filter(Boolean).join(' · '))}</span></div>
                <div class="lead-side">${pill(TESTIMONIAL.tone[t.status], TESTIMONIAL.status[t.status])}<small>${new Date(t.created_at).toLocaleDateString('pt-BR')}</small></div>
            </div>
            ${t.status === 'convite'
                ? `<p>Convite enviado; expira em ${new Date(t.invite_expires_at).toLocaleDateString('pt-BR')}.</p>`
                : `<p>“${esc(t.body)}”</p>
                   <div class="chips"><span>${t.source === 'manual' ? 'Registrado por você' : 'Enviado pelo cliente'}</span><span>Autorização: ${t.consent_note ? esc(t.consent_note) : `aceita em ${new Date(t.consent_at).toLocaleDateString('pt-BR')}`}</span></div>`}
            ${isAdmin() ? `<div class="actions">
                ${t.status !== 'convite' && t.status !== 'aprovado' ? `<button class="btn sm primary" data-act="t-approve" data-id="${t.id}"><i class="fas fa-check"></i> Aprovar e publicar</button>` : ''}
                ${t.status === 'aprovado' ? `<button class="btn sm ghost-dark" data-act="t-pending" data-id="${t.id}">Tirar do ar</button>` : ''}
                ${t.status === 'pendente' ? `<button class="btn sm ghost-dark" data-act="t-reject" data-id="${t.id}">Rejeitar</button>` : ''}
                <button class="btn sm ghost-dark danger-txt" data-act="t-delete" data-id="${t.id}" aria-label="Excluir"><i class="fas fa-trash"></i></button>
            </div>` : ''}
        </article>`).join('')}</div>${note}`;
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
            ${l.ai_at ? leadAnalysis(l) : ''}
            <div class="actions">
                ${l.status !== 'convertido' ? `<button class="btn sm primary" data-act="convert" data-id="${l.id}"><i class="fas fa-user-plus"></i> Converter em cliente</button>` : ''}
                ${l.status === 'novo' ? `<button class="btn sm ghost-dark" data-act="lead-contact" data-id="${l.id}">Marcar em contato</button>` : ''}
                ${!['descartado', 'convertido'].includes(l.status) ? `<button class="btn sm ghost-dark" data-act="lead-discard" data-id="${l.id}">Descartar</button>` : ''}
                <a class="btn sm ghost-dark" href="mailto:${esc(l.email)}"><i class="fas fa-envelope"></i> Responder</a>
                <button class="btn sm ghost-dark danger-txt" data-act="lead-delete" data-id="${l.id}" aria-label="Excluir solicitação"><i class="fas fa-trash"></i></button>
            </div>
        </article>`).join('')}</div>`;
}

const AI = {
    category: { site_institucional: 'Site institucional', sistema_web: 'Sistema web', aplicativo: 'Aplicativo', automacao: 'Automação', integracao: 'Integração', consultoria: 'Consultoria', outro: 'Outro' },
    complexity: { baixa: 'Complexidade baixa', media: 'Complexidade média', alta: 'Complexidade alta' },
    priority: { quente: 'Quente', morno: 'Morno', frio: 'Frio' }
};

// Análise gerada pela triagem com IA (python -m carcara triage); a resposta é só um rascunho
function leadAnalysis(l) {
    return `<details class="ai-box" ${l.status === 'novo' ? 'open' : ''}>
        <summary><i class="fas fa-wand-magic-sparkles"></i> Análise automática
            ${pill(l.ai_priority === 'quente' ? 'bad' : l.ai_priority === 'morno' ? 'warn' : 'muted', AI.priority[l.ai_priority] || l.ai_priority)}
            <span class="chips inline"><span>${esc(AI.category[l.ai_category] || l.ai_category)}</span><span>${esc(AI.complexity[l.ai_complexity] || l.ai_complexity)}</span></span></summary>
        <p>${esc(l.ai_summary)}</p>
        <strong>Próximos passos</strong><p class="pre">${esc(l.ai_next_steps)}</p>
        <strong>Rascunho de resposta</strong><p class="pre">${esc(l.ai_reply)}</p>
    </details>`;
}

// ===== FINANCEIRO =====
const paymentState = y => (y.paid_at ? 'pago' : y.due_date < isoToday() ? 'atrasado' : 'pendente');

function renderFinance() {
    const c = state.summary.counts;
    const totals = exportBar('financeiro', 'Lançamentos do mês') + `<div class="kpis three">
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

// ===== USUÁRIOS =====
function renderUsers() {
    const list = state.users.filter(u => matches(u.name, u.email));
    if (!list.length) return empty('Nenhum usuário encontrado.');
    return `<div class="grid-3">${list.map(u => `
        <button class="card client" data-edit="users:${u.id}">
            <div class="client-top"><span class="mini-av lg"${u.avatar ? ` style="background-image:url('${u.avatar}')"` : ''}>${u.avatar ? '' : esc(u.name.charAt(0).toUpperCase())}</span>
                <div><strong>${esc(u.name)}</strong><span>${esc(u.email)}</span></div>
                ${u.id === state.user.id ? pill('info', 'Você') : ''}</div>
            <small>${u.role === 'admin' ? 'Administrador' : 'Membro'} · Criado em ${new Date(u.created_at).toLocaleDateString('pt-BR')}</small>
        </button>`).join('')}</div>
        <p class="hint">Administradores gerenciam usuários; membros usam o painel e editam só o próprio perfil. Senhas ficam criptografadas e não podem ser consultadas.</p>`;
}

// ===== AÇÕES RÁPIDAS =====
async function runAction(act, id) {
    try {
        if (act === 'pay') await api(`/payments/${id}`, { method: 'PUT', body: { paid_at: isoToday() } });
        else if (act === 'unpay') await api(`/payments/${id}`, { method: 'PUT', body: { paid_at: '' } });
        else if (act === 'lead-contact') await api(`/leads/${id}`, { method: 'PUT', body: { status: 'contato' } });
        else if (act === 'lead-discard') await api(`/leads/${id}`, { method: 'PUT', body: { status: 'descartado' } });
        else if (act === 'invite') return openForm('invites');
        else if (act === 't-approve') { await api(`/testimonials/${id}`, { method: 'PUT', body: { status: 'aprovado' } }); toast('Publicado no site.'); }
        else if (act === 't-pending') await api(`/testimonials/${id}`, { method: 'PUT', body: { status: 'pendente' } });
        else if (act === 't-reject') await api(`/testimonials/${id}`, { method: 'PUT', body: { status: 'rejeitado' } });
        else if (act === 't-delete') {
            if (!confirm('Excluir este depoimento?')) return;
            await api(`/testimonials/${id}`, { method: 'DELETE' });
        } else if (act === 'lead-delete') {
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
    users: {
        title: 'usuário', list: () => state.users,
        fields: record => [
            { key: 'name', label: 'Nome', required: true, full: true },
            { key: 'email', label: 'E-mail', type: 'email', required: true, full: true },
            ...(isAdmin() ? [{ key: 'role', label: 'Perfil', type: 'select', required: true, full: true, def: 'membro', options: [{ value: 'membro', label: 'Membro' }, { value: 'admin', label: 'Administrador' }] }] : []),
            ...(record && record.id === state.user.id ? [{ key: 'current_password', label: 'Senha atual (obrigatória só para trocar a senha)', type: 'password', full: true, noPrefill: true, maxlength: 72 }] : []),
            { key: 'password', label: record ? 'Nova senha (deixe em branco para manter)' : 'Senha (mín. 10 caracteres)', type: 'password', required: !record, full: true, noPrefill: true, minlength: 10, maxlength: 72 },
            { key: 'password_confirm', label: record ? 'Confirmar nova senha' : 'Confirmar senha', type: 'password', required: !record, full: true, noPrefill: true, maxlength: 72 }
        ]
    },
    invites: {
        title: 'convite de depoimento', list: () => [],
        fields: () => [
            { key: 'client_id', label: 'Para qual cliente?', type: 'select', required: true, full: true, options: [{ value: '', label: 'Selecione um cliente' }, ...state.clients.map(c => ({ value: c.id, label: `${c.name}${c.company ? ` · ${c.company}` : ''}` }))] }
        ]
    },
    testimonials: {
        title: 'depoimento recebido por fora', list: () => [],
        fields: () => [
            { key: 'client_id', label: 'Cliente', type: 'select', full: true, options: [{ value: '', label: 'Sem vínculo' }, ...state.clients.map(c => ({ value: c.id, label: `${c.name}${c.company ? ` · ${c.company}` : ''}` }))] },
            { key: 'author_name', label: 'Nome de quem escreveu', required: true },
            { key: 'author_role', label: 'Cargo e empresa' },
            { key: 'body', label: 'Depoimento (como foi enviado, sem alterações)', type: 'textarea', required: true, full: true },
            { key: 'consent_note', label: 'Como o cliente autorizou a publicação', required: true, full: true, placeholder: 'Ex.: autorizou por WhatsApp em 28/10/2026' }
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
    const attrs = [f.minlength && `minlength="${f.minlength}"`, f.maxlength && `maxlength="${f.maxlength}"`, f.type === 'password' && 'autocomplete="new-password"'].filter(Boolean).join(' ');
    let control;
    if (f.type === 'select') {
        control = `<select id="${id}" name="${f.key}" ${req}>${f.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
        control = `<textarea id="${id}" name="${f.key}" rows="3">${esc(v)}</textarea>`;
    } else {
        const extra = ['min', 'max', 'step'].filter(a => f[a] !== undefined).map(a => `${a}="${f[a]}"`).join(' ');
        control = `<input id="${id}" name="${f.key}" type="${f.type || 'text'}" value="${esc(v)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${extra} ${attrs} ${req}>`;
        if (f.type === 'password') {
            control = `<div class="pw">${control}<button type="button" class="pw-eye" data-eye aria-label="Mostrar senha" aria-pressed="false"><i class="fas fa-eye"></i></button></div>`;
        }
    }
    const optional = f.required || f.type === 'password' ? '' : ' <em>(opcional)</em>';
    return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${f.label}${optional}</label>${control}</div>`;
}

function openForm(kind, id = null) {
    const cfg = FORMS[kind];
    if (kind === 'payments' && !state.projects.length) return toast('Cadastre um projeto antes de lançar valores.', true);
    const record = id ? cfg.list().find(r => r.id === id) : null;
    if (kind === 'users' && !isAdmin() && record?.id !== state.user.id) return toast('Apenas administradores podem alterar outros usuários.', true);
    editing = { kind, id };
    $('#formTitle').textContent = `${record ? 'Editar' : 'Novo'} ${cfg.title}`;
    $('#formFields').innerHTML = cfg.fields(record).map(f => fieldHtml(f, f.noPrefill ? '' : record?.[f.key])).join('');
    $('#formError').hidden = true;
    $('#formDelete').hidden = !record || (kind === 'users' && (record.id === state.user.id || !isAdmin()));
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
    let confirmation = '';
    for (const el of $$('#formFields [name]')) {
        if (el.required && !el.value.trim()) { err.textContent = `Preencha o campo "${el.labels[0].textContent.replace('(opcional)', '').trim()}".`; err.hidden = false; return el.focus(); }
        if (el.name === 'password_confirm') { confirmation = el.value; continue; } // só confere; não vai para a API
        if (el.type === 'password' && !el.value) continue; // em edição, vazio mantém a senha atual
        if (el.minLength > 0 && el.value && el.value.length < el.minLength) { err.textContent = `A senha deve ter ao menos ${el.minLength} caracteres.`; err.hidden = false; return el.focus(); }
        body[el.name] = el.value;
    }
    if ($('#f_password_confirm') && (body.password ?? '') !== confirmation) {
        err.textContent = 'As senhas não coincidem.';
        err.hidden = false;
        return $('#f_password_confirm').focus();
    }
    const btn = $('#formSave');
    btn.disabled = true;
    try {
        const path = `/${editing.kind}${editing.id ? `/${editing.id}` : ''}`;
        const saved = await api(path, { method: editing.id ? 'PUT' : 'POST', body });
        if (editing.kind === 'invites') await shareInvite(saved);
        if (editing.kind === 'users' && editing.id === state.user.id) { // atualiza nome/e-mail exibidos
            state.user = { ...state.user, name: saved.name, email: saved.email, role: saved.role };
            showApp();
        }
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

// o link só existe neste momento (o servidor guarda apenas o hash): copia e mostra para o envio
async function shareInvite({ token }) {
    const link = `${location.origin}/depoimento.html#${token}`;
    let copied = false;
    try { await navigator.clipboard.writeText(link); copied = true; } catch { /* sem permissão da área de transferência */ }
    closeForm();
    window.prompt(copied ? 'Link copiado! Envie ao cliente (vale 30 dias, uso único):' : 'Copie o link e envie ao cliente (vale 30 dias, uso único):', link);
}

$('#formDelete').addEventListener('click', async () => {
    const what = { clients: 'este cliente (os projetos dele ficam sem cliente)', projects: 'este projeto e todos os seus lançamentos financeiros', payments: 'este lançamento', users: 'este usuário (ele perde o acesso imediatamente)' }[editing.kind];
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
