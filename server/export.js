// Relatórios para download (Excel e PDF): financeiro do mês e resumo mensal
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const NAVY = '#0F2947';
const ORANGE = '#FF6A1A';
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brDate = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');
const monthLabel = m => new Date(`${m}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

function monthBounds(month) {
    const [y, m] = month.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return [`${month}-01`, next];
}

const stateOf = y => (y.paid_at ? 'Pago' : y.overdue ? 'Atrasado' : 'Pendente');

// ===== Dados =====
async function financeData(pool, month) {
    const [start, end] = monthBounds(month);
    const { rows } = await pool.query(
        `SELECT y.description, y.amount, y.due_date, y.paid_at, (y.paid_at IS NULL AND y.due_date < CURRENT_DATE) AS overdue,
                p.title AS project, c.name AS client
         FROM payments y JOIN projects p ON p.id = y.project_id LEFT JOIN clients c ON c.id = p.client_id
         WHERE (y.due_date >= $1 AND y.due_date < $2) OR (y.paid_at >= $1 AND y.paid_at < $2)
         ORDER BY COALESCE(y.paid_at, y.due_date), y.id`, [start, end]);
    const inMonth = d => d && d >= start && d < end;
    const sum = list => list.reduce((t, y) => t + y.amount, 0);
    return {
        month, rows,
        totals: {
            received: sum(rows.filter(y => inMonth(y.paid_at))),
            pending: sum(rows.filter(y => !y.paid_at && !y.overdue)),
            overdue: sum(rows.filter(y => y.overdue))
        }
    };
}

async function summaryData(pool, month) {
    const [start, end] = monthBounds(month);
    const q = (sql, params = []) => pool.query(sql, params).then(r => r.rows);
    const [[counts], received, open, projects] = await Promise.all([
        q(`SELECT (SELECT count(*)::int FROM clients WHERE created_at >= $1 AND created_at < $2) AS new_clients,
                  (SELECT count(*)::int FROM leads WHERE created_at >= $1 AND created_at < $2) AS new_leads,
                  (SELECT count(*)::int FROM projects WHERE status = 'concluido') AS done_projects`, [start, end]),
        q(`SELECT y.paid_at, y.description, y.amount, p.title AS project, c.name AS client
           FROM payments y JOIN projects p ON p.id = y.project_id LEFT JOIN clients c ON c.id = p.client_id
           WHERE y.paid_at >= $1 AND y.paid_at < $2 ORDER BY y.paid_at, y.id`, [start, end]),
        q(`SELECT y.due_date, y.description, y.amount, (y.due_date < CURRENT_DATE) AS overdue, p.title AS project, c.name AS client
           FROM payments y JOIN projects p ON p.id = y.project_id LEFT JOIN clients c ON c.id = p.client_id
           WHERE y.paid_at IS NULL ORDER BY y.due_date, y.id`),
        q(`SELECT p.title, p.status, p.progress, p.budget, p.due_date, c.name AS client
           FROM projects p LEFT JOIN clients c ON c.id = p.client_id
           WHERE p.status IN ('proposta', 'em_andamento', 'pausado') ORDER BY p.due_date NULLS LAST, p.id`)
    ]);
    const sum = list => list.reduce((t, y) => t + y.amount, 0);
    return {
        month, received, open, projects, counts,
        totals: { received: sum(received), open: sum(open), overdue: sum(open.filter(y => y.overdue)) }
    };
}

const PROJECT_STATUS = { proposta: 'Proposta', em_andamento: 'Em andamento', pausado: 'Pausado' };

// ===== Excel =====
function sheet(wb, name, columns, rows) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map(c => ({ header: c.label, key: c.key, width: c.width, style: c.format ? { numFmt: c.format } : {} }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY.slice(1)}` } };
    head.alignment = { vertical: 'middle' };
    rows.forEach(r => ws.addRow(r));
    return ws;
}

function kpiSheet(wb, title, subtitle, items) {
    const ws = wb.addWorksheet('Resumo');
    ws.getColumn(1).width = 34;
    ws.getColumn(2).width = 20;
    ws.addRow([title]).font = { bold: true, size: 14 };
    ws.addRow([subtitle]).font = { color: { argb: 'FF5B6675' } };
    ws.addRow([]);
    for (const [label, value, format] of items) {
        const row = ws.addRow([label, value]);
        if (format) row.getCell(2).numFmt = format;
        row.getCell(2).alignment = { horizontal: 'right' };
    }
    return ws;
}

const MONEY = '"R$" #,##0.00';
const asDate = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`) : null);

async function financeXlsx(data) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Carcará Tecnologia';
    const t = data.totals;
    kpiSheet(wb, 'Financeiro', monthLabel(data.month), [
        ['Recebido no mês', t.received, MONEY], ['A receber (vence no mês)', t.pending, MONEY], ['Em atraso', t.overdue, MONEY],
        ['Lançamentos listados', data.rows.length, '0']
    ]);
    sheet(wb, 'Lançamentos', [
        { label: 'Vencimento', key: 'due', width: 13, format: 'DD/MM/YYYY' }, { label: 'Descrição', key: 'desc', width: 34 },
        { label: 'Projeto', key: 'project', width: 30 }, { label: 'Cliente', key: 'client', width: 26 },
        { label: 'Valor', key: 'amount', width: 16, format: MONEY }, { label: 'Situação', key: 'state', width: 12 },
        { label: 'Pago em', key: 'paid', width: 13, format: 'DD/MM/YYYY' }
    ], data.rows.map(y => ({ due: asDate(y.due_date), desc: y.description, project: y.project, client: y.client || '', amount: y.amount, state: stateOf(y), paid: asDate(y.paid_at) })));
    return wb.xlsx.writeBuffer();
}

async function summaryXlsx(data) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Carcará Tecnologia';
    const t = data.totals, c = data.counts;
    kpiSheet(wb, 'Resumo mensal', monthLabel(data.month), [
        ['Recebido no mês', t.received, MONEY], ['A receber (total em aberto)', t.open, MONEY], ['Em atraso', t.overdue, MONEY],
        ['Novos clientes no mês', c.new_clients, '0'], ['Novas solicitações no mês', c.new_leads, '0'], ['Projetos concluídos (acumulado)', c.done_projects, '0']
    ]);
    sheet(wb, 'Recebimentos', [
        { label: 'Data', key: 'date', width: 13, format: 'DD/MM/YYYY' }, { label: 'Descrição', key: 'desc', width: 34 },
        { label: 'Projeto', key: 'project', width: 30 }, { label: 'Cliente', key: 'client', width: 26 }, { label: 'Valor', key: 'amount', width: 16, format: MONEY }
    ], data.received.map(y => ({ date: asDate(y.paid_at), desc: y.description, project: y.project, client: y.client || '', amount: y.amount })));
    sheet(wb, 'A receber', [
        { label: 'Vencimento', key: 'due', width: 13, format: 'DD/MM/YYYY' }, { label: 'Descrição', key: 'desc', width: 34 },
        { label: 'Projeto', key: 'project', width: 30 }, { label: 'Cliente', key: 'client', width: 26 },
        { label: 'Valor', key: 'amount', width: 16, format: MONEY }, { label: 'Situação', key: 'state', width: 12 }
    ], data.open.map(y => ({ due: asDate(y.due_date), desc: y.description, project: y.project, client: y.client || '', amount: y.amount, state: y.overdue ? 'Atrasado' : 'Pendente' })));
    sheet(wb, 'Projetos', [
        { label: 'Projeto', key: 'title', width: 34 }, { label: 'Cliente', key: 'client', width: 26 }, { label: 'Status', key: 'status', width: 16 },
        { label: 'Progresso (%)', key: 'progress', width: 14 }, { label: 'Orçamento', key: 'budget', width: 16, format: MONEY }, { label: 'Prazo', key: 'due', width: 13, format: 'DD/MM/YYYY' }
    ], data.projects.map(p => ({ title: p.title, client: p.client || '', status: PROJECT_STATUS[p.status] || p.status, progress: p.progress, budget: p.budget, due: asDate(p.due_date) })));
    return wb.xlsx.writeBuffer();
}

// ===== PDF =====
function pdf(build) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Author: 'Carcará Tecnologia' } });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        build(doc);
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i++) { // rodapé com paginação
            doc.switchToPage(i);
            doc.page.margins.bottom = 0; // escrever abaixo da margem inferior faria o PDFKit abrir outra página
            doc.font('Helvetica').fontSize(8).fillColor('#5B6675')
                .text(`Carcará Tecnologia · página ${i + 1} de ${range.count}`, 40, doc.page.height - 30, { width: doc.page.width - 80, align: 'center', lineBreak: false });
        }
        doc.end();
    });
}

function header(doc, title, subtitle) {
    doc.rect(0, 0, doc.page.width, 78).fill(NAVY);
    doc.rect(0, 78, doc.page.width, 3).fill(ORANGE);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text(title, 40, 22, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillColor('#C7D3E3').text(`Carcará Tecnologia · ${subtitle}`, 40, 48, { lineBreak: false });
    doc.x = 40;
    doc.y = 100;
}

function kpis(doc, items) {
    const gap = 10, w = (doc.page.width - 80 - gap * (items.length - 1)) / items.length, y = doc.y;
    items.forEach(([label, value, color], i) => {
        const x = 40 + i * (w + gap);
        doc.roundedRect(x, y, w, 52, 6).fill('#F4F6F9');
        doc.rect(x, y + 8, 3, 36).fill(color || ORANGE);
        doc.fillColor('#5B6675').font('Helvetica').fontSize(8).text(label, x + 12, y + 10, { width: w - 16, lineBreak: false });
        doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(value, x + 12, y + 26, { width: w - 16, lineBreak: false });
    });
    doc.x = 40;
    doc.y = y + 70;
}

// Corta o texto, com reticências, para caber na largura (a fonte e o tamanho já devem estar definidos no doc)
function fit(doc, text, width) {
    if (doc.widthOfString(text) <= width) return text;
    let t = text;
    while (t.length > 1 && doc.widthOfString(`${t}…`) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
}

// Tabela simples com quebra de página e cabeçalho repetido; textos longos são cortados com reticências
function table(doc, title, columns, rows, emptyText) {
    const left = 40, width = doc.page.width - 80, rowH = 20, bottom = doc.page.height - 50;
    const total = columns.reduce((t, c) => t + c.w, 0);
    const cols = columns.map(c => ({ ...c, width: (c.w / total) * width }));
    const head = () => {
        const y = doc.y;
        doc.rect(left, y, width, rowH).fill(NAVY);
        let x = left;
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
        for (const c of cols) { doc.text(c.label, x + 6, y + 6, { width: c.width - 12, align: c.align || 'left', lineBreak: false }); x += c.width; }
        doc.y = y + rowH;
    };
    if (doc.y + 70 > bottom) doc.addPage();
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(title, left, doc.y);
    doc.y += 6;
    if (!rows.length) {
        doc.fillColor('#5B6675').font('Helvetica').fontSize(9).text(emptyText, left, doc.y + 4);
        doc.y += 28;
        return;
    }
    head();
    rows.forEach((r, i) => {
        if (doc.y + rowH > bottom) { doc.addPage(); doc.y = 40; head(); }
        const y = doc.y;
        if (i % 2) doc.rect(left, y, width, rowH).fill('#F4F6F9');
        let x = left;
        cols.forEach((c, k) => {
            doc.fillColor(r._color && k === r._colorCol ? r._color : '#1B2430').font(r._bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
                .text(fit(doc, String(r[c.key] ?? ''), c.width - 12), x + 6, y + 6, { width: c.width - 12, align: c.align || 'left', lineBreak: false });
            x += c.width;
        });
        doc.y = y + rowH;
    });
    doc.y += 18;
}

const STATE_COLOR = { Pago: '#166534', Atrasado: '#B91C1C', Pendente: '#1D4ED8' };

function financePdf(data) {
    const t = data.totals;
    return pdf(doc => {
        header(doc, 'Relatório financeiro', monthLabel(data.month));
        kpis(doc, [['Recebido no mês', brl(t.received), '#16A34A'], ['A receber (vence no mês)', brl(t.pending), '#2563EB'], ['Em atraso', brl(t.overdue), '#EF4444']]);
        table(doc, 'Lançamentos do mês', [
            { label: 'Vencimento', key: 'due', w: 10 }, { label: 'Descrição', key: 'desc', w: 32 }, { label: 'Cliente / projeto', key: 'who', w: 20 },
            { label: 'Situação', key: 'state', w: 12 }, { label: 'Valor', key: 'amount', w: 14, align: 'right' }
        ], data.rows.map(y => {
            const state = stateOf(y);
            return { due: brDate(y.due_date), desc: y.description, who: y.client || y.project, state: state === 'Pago' ? `Pago ${brDate(y.paid_at).slice(0, 5)}` : state, amount: brl(y.amount), _color: STATE_COLOR[state], _colorCol: 3 };
        }), 'Nenhum lançamento neste mês.');
    });
}

function summaryPdf(data) {
    const t = data.totals, c = data.counts;
    return pdf(doc => {
        header(doc, 'Resumo mensal', monthLabel(data.month));
        kpis(doc, [['Recebido no mês', brl(t.received), '#16A34A'], ['A receber (em aberto)', brl(t.open), '#2563EB'], ['Em atraso', brl(t.overdue), '#EF4444']]);
        kpis(doc, [['Novos clientes', String(c.new_clients), '#7C3AED'], ['Novas solicitações', String(c.new_leads), ORANGE], ['Projetos concluídos (total)', String(c.done_projects), '#0F766E']]);
        table(doc, 'Recebimentos do mês', [
            { label: 'Data', key: 'date', w: 10 }, { label: 'Descrição', key: 'desc', w: 30 }, { label: 'Cliente / projeto', key: 'who', w: 36 }, { label: 'Valor', key: 'amount', w: 14, align: 'right' }
        ], data.received.map(y => ({ date: brDate(y.paid_at), desc: y.description, who: y.client || y.project, amount: brl(y.amount) })), 'Nenhum recebimento neste mês.');
        table(doc, 'Valores em aberto', [
            { label: 'Vencimento', key: 'due', w: 11 }, { label: 'Descrição', key: 'desc', w: 28 }, { label: 'Cliente / projeto', key: 'who', w: 28 },
            { label: 'Situação', key: 'state', w: 11 }, { label: 'Valor', key: 'amount', w: 14, align: 'right' }
        ], data.open.map(y => { const state = y.overdue ? 'Atrasado' : 'Pendente'; return { due: brDate(y.due_date), desc: y.description, who: y.client || y.project, state, amount: brl(y.amount), _color: STATE_COLOR[state], _colorCol: 3 }; }), 'Nada em aberto.');
        table(doc, 'Projetos em andamento', [
            { label: 'Projeto', key: 'title', w: 32 }, { label: 'Cliente', key: 'client', w: 24 }, { label: 'Status', key: 'status', w: 14 },
            { label: 'Prazo', key: 'due', w: 12 }, { label: 'Prog.', key: 'progress', w: 8, align: 'right' }
        ], data.projects.map(p => ({ title: p.title, client: p.client || '—', status: PROJECT_STATUS[p.status] || p.status, due: brDate(p.due_date), progress: `${p.progress}%` })), 'Nenhum projeto em aberto.');
    });
}

const REPORTS = {
    financeiro: { data: financeData, xlsx: financeXlsx, pdf: financePdf, label: 'financeiro' },
    resumo: { data: summaryData, xlsx: summaryXlsx, pdf: summaryPdf, label: 'resumo-mensal' }
};

const TYPES = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf: 'application/pdf'
};

module.exports = { REPORTS, TYPES, MONTH_RE };
