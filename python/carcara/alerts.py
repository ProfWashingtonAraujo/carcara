"""Resumo diário de pendências: cobranças, prazos de projetos e solicitações sem resposta."""
from . import notify


def collect(conn, days: int = 3, lead_hours: int = 24) -> dict:
    q = lambda sql, params=(): conn.execute(sql, params).fetchall()
    return {
        "overdue": q("""SELECT y.description, y.amount, y.due_date, p.title AS project, c.name AS client
                        FROM payments y JOIN projects p ON p.id = y.project_id LEFT JOIN clients c ON c.id = p.client_id
                        WHERE y.paid_at IS NULL AND y.due_date < CURRENT_DATE ORDER BY y.due_date"""),
        "due_soon": q("""SELECT y.description, y.amount, y.due_date, p.title AS project, c.name AS client
                         FROM payments y JOIN projects p ON p.id = y.project_id LEFT JOIN clients c ON c.id = p.client_id
                         WHERE y.paid_at IS NULL AND y.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + %s ORDER BY y.due_date""", (days,)),
        "projects": q("""SELECT p.title, p.due_date, p.progress, c.name AS client
                         FROM projects p LEFT JOIN clients c ON c.id = p.client_id
                         WHERE p.status IN ('proposta', 'em_andamento') AND p.due_date IS NOT NULL AND p.due_date <= CURRENT_DATE + %s
                         ORDER BY p.due_date""", (days,)),
        "leads": q("""SELECT name, service, created_at FROM leads
                      WHERE status = 'novo' AND created_at < now() - make_interval(hours => %s) ORDER BY created_at""", (lead_hours,)),
    }


def _money(v) -> str:
    return f"R$ {float(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _day(d) -> str:
    return d.strftime("%d/%m")


def build_message(data: dict, days: int = 3, lead_hours: int = 24) -> tuple[str, str] | None:
    """Devolve (assunto, corpo), ou None se não há nada a avisar."""
    sections = []
    if data["overdue"]:
        total = sum(r["amount"] for r in data["overdue"])
        lines = [f"- {_day(r['due_date'])} · {_money(r['amount'])} · {r['client'] or r['project']} ({r['description']})" for r in data["overdue"]]
        sections.append(f"COBRANÇAS EM ATRASO ({_money(total)})\n" + "\n".join(lines))
    if data["due_soon"]:
        lines = [f"- {_day(r['due_date'])} · {_money(r['amount'])} · {r['client'] or r['project']} ({r['description']})" for r in data["due_soon"]]
        sections.append(f"VENCEM EM ATÉ {days} DIA(S)\n" + "\n".join(lines))
    if data["projects"]:
        lines = [f"- {_day(r['due_date'])} · {r['title']} ({r['progress']}% concluído){' · ' + r['client'] if r['client'] else ''}" for r in data["projects"]]
        sections.append(f"PROJETOS COM PRAZO PRÓXIMO OU VENCIDO\n" + "\n".join(lines))
    if data["leads"]:
        lines = [f"- {r['name']}{' · ' + r['service'] if r['service'] else ''} (recebida em {_day(r['created_at'])})" for r in data["leads"]]
        sections.append(f"SOLICITAÇÕES SEM RESPOSTA HÁ MAIS DE {lead_hours}H\n" + "\n".join(lines))
    if not sections:
        return None
    count = sum(len(data[k]) for k in data)
    return f"Painel Carcará: {count} pendência(s) hoje", "\n\n".join(sections)


def run(conn, days: int = 3, lead_hours: int = 24, dry_run: bool = False) -> str | None:
    message = build_message(collect(conn, days, lead_hours), days, lead_hours)
    if message is None:
        print("Nenhuma pendência.")
        return None
    subject, body = message
    if dry_run:
        print(f"{subject}\n\n{body}")
    else:
        print(f"Enviado por: {', '.join(notify.send(subject, body)) or 'terminal'}")
    return body
