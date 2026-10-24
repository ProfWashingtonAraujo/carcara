import argparse
from datetime import date

from . import alerts, db, notify, reports, screenshots, triage
from .config import OUT_DIR


def previous_month() -> str:
    today = date.today()
    year, month = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
    return f"{year}-{month:02d}"


def main() -> None:
    parser = argparse.ArgumentParser(prog="carcara", description="Automações da Carcará Tecnologia")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("report", help="Gera o relatório mensal (xlsx e pdf)")
    p.add_argument("--month", default=previous_month(), help="AAAA-MM (padrão: mês anterior)")
    p.add_argument("--email", action="store_true", help="Envia os arquivos por e-mail (MAIL_TO)")

    p = sub.add_parser("alerts", help="Resumo diário de cobranças, prazos e solicitações")
    p.add_argument("--days", type=int, default=3, help="Antecedência dos avisos, em dias")
    p.add_argument("--lead-hours", type=int, default=24, help="Horas até uma solicitação sem resposta virar alerta")
    p.add_argument("--dry-run", action="store_true", help="Só mostra, não envia")

    p = sub.add_parser("triage", help="Analisa com IA as solicitações novas")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--dry-run", action="store_true", help="Analisa mas não grava")

    p = sub.add_parser("screenshots", help="Atualiza a imagem dos cases a partir do site publicado")
    p.add_argument("--id", type=int, help="Só este case")
    p.add_argument("--all", action="store_true", help="Refaz também os cases que já têm imagem")

    p = sub.add_parser("serve", help="Sobe o serviço de diagnóstico de sites")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)

    args = parser.parse_args()

    if args.cmd == "serve":
        import uvicorn
        uvicorn.run("carcara.service:app", host=args.host, port=args.port)
        return

    with db.connect() as conn:
        if args.cmd == "report":
            data, files = reports.generate(conn, args.month, OUT_DIR)
            print(f"Recebido: {reports.brl(data['total_received'])} · em aberto: {reports.brl(data['total_open'])}")
            for f in files:
                print(f"Gerado: {f}")
            if args.email:
                notify.send(f"Relatório Carcará {args.month}", f"Segue o relatório de {args.month}: recebido {reports.brl(data['total_received'])}, em aberto {reports.brl(data['total_open'])}.", files)
        elif args.cmd == "alerts":
            alerts.run(conn, args.days, args.lead_hours, args.dry_run)
        elif args.cmd == "triage":
            triage.run(conn, args.limit, args.dry_run)
        elif args.cmd == "screenshots":
            screenshots.run(conn, args.id, args.all)


if __name__ == "__main__":
    main()
