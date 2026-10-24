"""Envio de avisos: e-mail (SMTP) e/ou webhook; sem nenhum configurado, apenas imprime."""
import json
import smtplib
import sys
import urllib.request
from email.message import EmailMessage
from pathlib import Path

from .config import env


def send(subject: str, body: str, attachments: list[Path] | None = None) -> list[str]:
    """Devolve os canais usados."""
    channels = []
    if env("SMTP_HOST") and env("MAIL_TO"):
        _send_email(subject, body, attachments or [])
        channels.append("email")
    if env("ALERT_WEBHOOK_URL"):
        _send_webhook(subject, body)
        channels.append("webhook")
    if not channels:
        # fora de um terminal (ex.: log público do GitHub Actions) o corpo traria nomes e valores
        shown = f"\n{body}" if sys.stdout.isatty() else " (conteúdo omitido; configure e-mail ou webhook para recebê-lo)"
        print(f"[sem canal configurado] {subject}{shown}")
    return channels


def _send_email(subject: str, body: str, attachments: list[Path]) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = env("MAIL_FROM") or env("SMTP_USER") or env("MAIL_TO")
    msg["To"] = env("MAIL_TO")
    msg.set_content(body)
    for path in attachments:
        maintype, subtype = ("application", "octet-stream")
        if path.suffix == ".pdf":
            subtype = "pdf"
        elif path.suffix == ".xlsx":
            subtype = "vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        msg.add_attachment(path.read_bytes(), maintype=maintype, subtype=subtype, filename=path.name)

    port = int(env("SMTP_PORT", "587"))
    smtp_cls = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
    with smtp_cls(env("SMTP_HOST"), port, timeout=30) as smtp:
        if port != 465:
            smtp.starttls()
        if env("SMTP_USER"):
            smtp.login(env("SMTP_USER"), env("SMTP_PASSWORD") or "")
        smtp.send_message(msg)


def _send_webhook(subject: str, body: str) -> None:
    # JSON simples; funciona com n8n, Zapier, Make ou um bot de WhatsApp/Telegram intermediário
    payload = json.dumps({"subject": subject, "text": f"{subject}\n\n{body}"}).encode()
    req = urllib.request.Request(env("ALERT_WEBHOOK_URL"), data=payload, headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=20).read()
