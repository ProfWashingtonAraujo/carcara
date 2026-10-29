"""Diagnóstico rápido de um site: segurança, SEO básico, desempenho e boas práticas.

Atenção: este módulo busca URLs informadas por terceiros. Antes de cada requisição (inclusive
redirecionamentos) o endereço é resolvido e recusado se apontar para rede interna.
"""
import ipaddress
import socket
import time
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

MAX_BYTES = 2_000_000
MAX_REDIRECTS = 3
TIMEOUT = 10.0
DEADLINE = 15.0  # prazo total da busca, incluindo redirecionamentos e leitura do corpo
ALLOWED_PORTS = {None, 80, 443}


class UrlRejected(ValueError):
    pass


def normalize_url(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw or len(raw) > 300:
        raise UrlRejected("Informe um endereço válido.")
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parsed = urlparse(raw)
        port = parsed.port
    except ValueError:
        raise UrlRejected("Endereço inválido.") from None
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UrlRejected("Use um endereço http ou https.")
    if parsed.username or parsed.password:
        raise UrlRejected("Endereço com usuário e senha não é aceito.")
    if port not in ALLOWED_PORTS:
        raise UrlRejected("Porta não permitida.")
    return raw


def assert_public(host: str) -> str:
    """Recusa endereços não públicos e devolve o IP validado, para a conexão usar exatamente ele."""
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise UrlRejected("Não foi possível encontrar este endereço.") from None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise UrlRejected("Este endereço não é público.")
    return infos[0][4][0]


def pinned(url: str, ip: str) -> tuple[str, dict, dict]:
    """Reescreve a URL para conectar ao IP já validado (evita DNS rebinding entre a checagem e a conexão)."""
    parsed = urlparse(url)
    host = parsed.hostname
    try:
        ipaddress.ip_address(host)
        return url, {}, {}  # já é um IP literal
    except ValueError:
        pass
    netloc = f"[{ip}]" if ":" in ip else ip
    if parsed.port:
        netloc += f":{parsed.port}"
    headers = {"Host": parsed.netloc}
    extensions = {"sni_hostname": host} if parsed.scheme == "https" else {}
    return parsed._replace(netloc=netloc).geturl(), headers, extensions


@dataclass
class Fetched:
    url: str
    status: int
    headers: httpx.Headers
    body: bytes
    seconds: float
    redirects: int


def fetch(raw_url: str, client: httpx.Client | None = None) -> Fetched:
    url = normalize_url(raw_url)
    own = client is None
    client = client or httpx.Client(follow_redirects=False, timeout=TIMEOUT, headers={"User-Agent": "CarcaraDiagnostico/1.0 (+https://www.carcaratech.com.br)"})
    deadline = time.monotonic() + DEADLINE
    try:
        for hop in range(MAX_REDIRECTS + 1):
            ip = assert_public(urlparse(url).hostname)
            target, headers, extensions = pinned(url, ip)
            start = time.perf_counter()
            with client.stream("GET", target, headers=headers, extensions=extensions) as resp:
                if resp.is_redirect and resp.headers.get("location"):
                    url = normalize_url(urljoin(url, resp.headers["location"]))
                    continue
                body = bytearray()
                for chunk in resp.iter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        break
                    if time.monotonic() > deadline:
                        raise UrlRejected("O site demorou demais para responder.")
                return Fetched(url, resp.status_code, resp.headers, bytes(body[:MAX_BYTES]), time.perf_counter() - start, hop)
        raise UrlRejected("Redirecionamentos demais.")
    except httpx.HTTPError as exc:
        raise UrlRejected(f"Não foi possível acessar o site ({type(exc).__name__}).") from None
    finally:
        if own:
            client.close()


@dataclass
class Finding:
    area: str          # seguranca | seo | desempenho | boas_praticas
    level: str         # ok | atencao | problema
    title: str
    advice: str = ""
    weight: int = 0


@dataclass
class Report:
    url: str
    score: int = 0
    findings: list[Finding] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def analyze(f: Fetched) -> Report:
    report = Report(url=f.url)
    out = report.findings

    def check(ok, area, title, advice, weight, warn=False):
        out.append(Finding(area, "ok" if ok else ("atencao" if warn else "problema"), title, "" if ok else advice, weight))

    h = {k.lower(): v for k, v in f.headers.items()}
    https = urlparse(f.url).scheme == "https"
    soup = BeautifulSoup(f.body.decode("utf-8", errors="replace"), "html.parser")

    # segurança
    check(https, "seguranca", "Site usa HTTPS", "Publique o site com HTTPS; sem ele, navegadores marcam como 'não seguro' e o Google penaliza.", 15)
    check("strict-transport-security" in h, "seguranca", "HSTS ativo", "Ative o cabeçalho Strict-Transport-Security para forçar HTTPS.", 5, warn=True)
    check("content-security-policy" in h, "seguranca", "Política de segurança de conteúdo (CSP)", "Defina um Content-Security-Policy para reduzir o risco de scripts maliciosos.", 5, warn=True)
    check(h.get("x-content-type-options", "").lower() == "nosniff", "seguranca", "X-Content-Type-Options", "Adicione X-Content-Type-Options: nosniff.", 3, warn=True)

    # desempenho
    check(f.seconds < 1.5, "desempenho", f"Resposta do servidor em {f.seconds:.2f}s", "Servidor lento. Revise hospedagem, cache e consultas ao banco.", 10, warn=f.seconds < 3)
    check(h.get("content-encoding", "").lower() in ("gzip", "br", "zstd", "deflate"), "desempenho", "Compressão de texto", "Ative gzip ou brotli para reduzir o tamanho das páginas.", 5, warn=True)
    check(len(f.body) < 500_000, "desempenho", f"HTML com {len(f.body) // 1024} KB", "HTML muito pesado; separe scripts e estilos e remova código não usado.", 5, warn=True)
    check("cache-control" in h, "desempenho", "Cache configurado", "Defina Cache-Control para arquivos estáticos.", 3, warn=True)

    # SEO
    title = (soup.title.string or "").strip() if soup.title else ""
    check(30 <= len(title) <= 65, "seo", "Título da página" + (f" ({len(title)} caracteres)" if title else " ausente"),
          "Use um título entre 30 e 65 caracteres descrevendo o negócio.", 10, warn=bool(title))
    desc = soup.find("meta", attrs={"name": "description"})
    dtext = (desc.get("content") or "").strip() if desc else ""
    check(70 <= len(dtext) <= 170, "seo", "Meta description" + (f" ({len(dtext)} caracteres)" if dtext else " ausente"),
          "Escreva uma descrição de 70 a 160 caracteres: é o texto que aparece no Google.", 8, warn=bool(dtext))
    h1s = soup.find_all("h1")
    check(len(h1s) == 1, "seo", f"{len(h1s)} título(s) principal (h1)", "Use exatamente um h1 por página.", 5, warn=len(h1s) > 1)
    check(bool(soup.find("link", rel="canonical")), "seo", "Link canônico", "Adicione <link rel=\"canonical\"> para evitar conteúdo duplicado.", 3, warn=True)
    check(bool(soup.find("meta", property="og:title")), "seo", "Prévia em redes sociais (Open Graph)", "Adicione tags og:title, og:description e og:image para o link ficar bonito ao compartilhar.", 3, warn=True)

    # páginas montadas por JavaScript chegam quase vazias; o que vem abaixo é só o que o HTML inicial mostra
    spa = len(soup.get_text(strip=True)) < 200 and bool(soup.find("script"))
    check(not spa, "seo", "Conteúdo carregado por JavaScript",
          "O HTML inicial tem pouco texto: buscadores e redes sociais podem enxergar menos do que os visitantes. Considere renderização no servidor ou pré-renderização. Os itens de título, h1 e imagens abaixo refletem só esse HTML inicial.", 3, warn=True)

    # boas práticas
    check(bool(soup.find("meta", attrs={"name": "viewport"})), "boas_praticas", "Adaptado a celulares (viewport)", "Adicione a meta viewport; sem ela o site fica minúsculo no celular.", 8)
    check(bool(soup.html and soup.html.get("lang")), "boas_praticas", "Idioma da página declarado", "Defina o atributo lang na tag html (ex.: pt-BR).", 3, warn=True)
    imgs = soup.find_all("img")
    no_alt = [i for i in imgs if i.get("alt") is None]
    check(not no_alt, "boas_praticas", f"{len(imgs) - len(no_alt)} de {len(imgs)} imagens com texto alternativo" if imgs else "Sem imagens no HTML",
          f"{len(no_alt)} imagem(ns) sem atributo alt: prejudica acessibilidade e SEO.", 5, warn=True)
    check(f.status == 200, "boas_praticas", f"Resposta HTTP {f.status}", "A página principal deveria responder 200.", 5)

    report.stats = {"status": f.status, "segundos": round(f.seconds, 2), "kb": max(1, -(-len(f.body) // 1024)), "redirecionamentos": f.redirects, "imagens": len(imgs)}
    total = sum(x.weight for x in out)
    earned = sum(x.weight * (1 if x.level == "ok" else .5 if x.level == "atencao" else 0) for x in out)
    report.score = round(100 * earned / total) if total else 0
    return report


def diagnose(url: str, client: httpx.Client | None = None) -> Report:
    return analyze(fetch(url, client))


def to_dict(r: Report) -> dict:
    return {
        "url": r.url, "score": r.score, "stats": r.stats,
        "findings": [{"area": x.area, "level": x.level, "title": x.title, "advice": x.advice} for x in r.findings],
    }
