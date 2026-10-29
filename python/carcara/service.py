"""API do diagnóstico de sites (FastAPI) e página simples para usá-la."""
import threading
import time
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from . import diagnostico
from .config import env

app = FastAPI(title="Carcará · Diagnóstico de sites", docs_url=None, redoc_url=None)

origins = [o.strip() for o in (env("CORS_ORIGINS", "") or "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST", "GET"], allow_headers=["Content-Type"])

# limite por IP: cada diagnóstico faz uma requisição a um site de terceiros
LIMIT, WINDOW = 8, 600
_hits: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


def client_ip(request: Request) -> str:
    # o Render acrescenta o IP real do cliente ao fim do X-Forwarded-For; o que vem antes é forjável
    forwarded = request.headers.get("x-forwarded-for", "")
    last = forwarded.rsplit(",", 1)[-1].strip()
    if last:
        return last
    return request.client.host if request.client else "?"


def check_rate(ip: str) -> None:
    now = time.monotonic()
    with _lock:
        q = _hits[ip]
        while q and now - q[0] > WINDOW:
            q.popleft()
        if len(q) >= LIMIT:
            raise HTTPException(429, "Muitas consultas. Tente novamente em alguns minutos.")
        q.append(now)
        if len(_hits) > 5000:  # evita crescimento sem fim
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > WINDOW]:
                del _hits[k]


class Request_(BaseModel):
    url: str = Field(min_length=3, max_length=300)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/diagnostico")
def run_diagnostico(body: Request_, request: Request):
    check_rate(client_ip(request))
    try:
        return diagnostico.to_dict(diagnostico.diagnose(body.url))
    except diagnostico.UrlRejected as exc:
        raise HTTPException(400, str(exc)) from None


PAGE = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diagnóstico de site | Carcará Tecnologia</title>
<style>
:root{--bg:#0f2947;--card:#fff;--text:#1b2430;--mut:#5b6675;--or:#ff6a1a;--ok:#16a34a;--warn:#d97706;--bad:#dc2626}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:24px 16px}
main{max-width:760px;margin:0 auto}h1{color:#fff;font-size:1.7rem;margin:16px 0 6px}p.sub{color:#c7d3e3;margin:0 0 22px}
form{display:flex;gap:10px;flex-wrap:wrap}input{flex:1;min-width:220px;padding:14px 16px;border-radius:12px;border:0;font-size:1rem}
button{padding:14px 22px;border-radius:12px;border:0;background:var(--or);color:#fff;font-weight:600;font-size:1rem;cursor:pointer}button:disabled{opacity:.6}
.card{background:var(--card);border-radius:16px;padding:20px;margin-top:18px}.score{display:flex;align-items:center;gap:18px}
.ring{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:1.5rem;color:#fff}
h2{font-size:1rem;margin:20px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
ul{list-style:none;margin:0;padding:0}li{padding:10px 0;border-top:1px solid #eef1f5;display:flex;gap:10px}li small{display:block;color:var(--mut);margin-top:2px}
.dot{flex:none;width:10px;height:10px;border-radius:50%;margin-top:6px}.err{color:#fecaca;margin-top:14px}
a.cta{display:inline-block;margin-top:16px;color:var(--or);font-weight:600}
</style></head><body><main>
<h1>Diagnóstico gratuito do seu site</h1><p class="sub">Veja em segundos como está a segurança, o SEO e o desempenho da sua página.</p>
<form id="f"><input id="u" placeholder="seusite.com.br" required aria-label="Endereço do site"><button id="b">Analisar</button></form>
<p class="err" id="e" role="alert" hidden></p><div id="r"></div></main>
<script>
const AREAS={seguranca:'Segurança',desempenho:'Desempenho',seo:'SEO',boas_praticas:'Boas práticas'};
const COLOR={ok:'var(--ok)',atencao:'var(--warn)',problema:'var(--bad)'};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
f.addEventListener('submit',async ev=>{ev.preventDefault();e.hidden=true;r.innerHTML='';b.disabled=true;b.textContent='Analisando...';
try{const res=await fetch('/diagnostico',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u.value})});
const d=await res.json();if(!res.ok)throw new Error(d.detail||'Erro inesperado.');
const c=d.score>=80?'var(--ok)':d.score>=55?'var(--warn)':'var(--bad)';
let h=`<div class="card"><div class="score"><div class="ring" style="background:${c}">${d.score}</div><div><strong>${esc(d.url)}</strong><br><span style="color:var(--mut)">Nota de 0 a 100 · resposta em ${d.stats.segundos}s · ${d.stats.kb} KB</span></div></div>`;
for(const [k,t] of Object.entries(AREAS)){const items=d.findings.filter(x=>x.area===k);if(!items.length)continue;
h+=`<h2>${t}</h2><ul>`+items.map(x=>`<li><span class="dot" style="background:${COLOR[x.level]}"></span><div>${esc(x.title)}${x.advice?`<small>${esc(x.advice)}</small>`:''}</div></li>`).join('')+'</ul>';}
r.innerHTML=h+'<a class="cta" href="https://www.carcaratech.com.br/#contato">Quer corrigir isso? Fale com a Carcará →</a></div>';
}catch(x){e.textContent=x.message;e.hidden=false}finally{b.disabled=false;b.textContent='Analisar'}});
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def page():
    return PAGE
