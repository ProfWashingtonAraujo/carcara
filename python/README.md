# Automações em Python

Ferramentas que usam o mesmo Postgres do painel. Tudo roda pela linha de comando:

```bash
cd python
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # DATABASE_URL é lido de ../server/.env se não estiver aqui
python -m carcara <comando>
```

| Comando | O que faz |
|---|---|
| `report [--month 2026-10] [--email]` | Relatório mensal em Excel e PDF (`python/out/`): recebido, a receber, atrasos, projetos. Padrão: mês anterior. |
| `alerts [--days 3] [--lead-hours 24] [--dry-run]` | Resumo de cobranças em atraso ou a vencer, prazos de projetos e solicitações sem resposta. |
| `triage [--limit 20] [--dry-run]` | Analisa com a Claude as solicitações novas (categoria, complexidade, prioridade, resumo, próximos passos e rascunho de resposta). O resultado aparece no card da solicitação, no painel. |
| `screenshots [--id N] [--all]` | Tira screenshot do site de cada case e grava como imagem de capa. Sem flags, só cases que ainda não têm imagem. |
| `serve [--port 8000]` | Diagnóstico de sites: página em `/` e API em `POST /diagnostico`. |

## Avisos e relatórios

`alerts` e `report --email` usam e-mail (`SMTP_*`, `MAIL_TO`) e/ou um webhook (`ALERT_WEBHOOK_URL`). O webhook recebe `{"subject", "text"}` e serve para ligar o aviso a WhatsApp ou Telegram por n8n, Zapier ou Make. Sem nenhum canal configurado, o texto sai no terminal.

## Triagem com IA

Funciona com provedores **gratuitos** ou com a Claude (paga):

| `AI_PROVIDER` | Chave | Custo |
|---|---|---|
| `groq` (padrão sem chave da Claude) | `AI_API_KEY` de console.groq.com | grátis, com limite de requisições |
| `gemini` | `AI_API_KEY` de aistudio.google.com | grátis; o Google pode usar o conteúdo para melhorar produtos |
| `openrouter` | `AI_API_KEY` de openrouter.ai | modelos `:free`, limite diário baixo |
| `claude` (padrão se houver `ANTHROPIC_API_KEY`) | `ANTHROPIC_API_KEY` | pago por uso |

`AI_MODEL` e `AI_BASE_URL` trocam o modelo ou o endereço (qualquer API compatível com OpenAI serve). Os modelos gratuitos mudam com o tempo: se um sumir, ajuste `AI_MODEL`. Quando o limite gratuito acaba, a execução para e as solicitações restantes são analisadas na vez seguinte.

As solicitações têm dados pessoais (nome, e-mail, telefone); confira a política de dados do provedor antes de usar. O texto do visitante é tratado como dado, e a resposta é só um rascunho: nada é enviado ao cliente automaticamente. No GitHub Actions, guarde a chave em *Secrets* (`AI_API_KEY`) e o provedor em *Variables* (`AI_PROVIDER`).

## Diagnóstico de sites

Recebe uma URL e devolve nota de 0 a 100 com achados de segurança, desempenho, SEO e boas práticas. Limites e cuidados:

- Recusa endereços que apontem para rede interna (inclusive via redirecionamento), portas diferentes de 80/443 e respostas acima de 2 MB.
- Limite de 8 consultas por IP a cada 10 minutos, na memória do processo.
- Analisa só o HTML inicial. Sites montados por JavaScript (React, Vue) aparecem com pouco conteúdo, e o relatório avisa isso.
- Resolução de DNS e requisição são feitas em momentos separados, então um DNS malicioso que mude de resposta entre os dois passos ainda é um risco residual de qualquer verificação desse tipo.

Publicação: o `render.yaml` já inclui o serviço `carcara-diagnostico`.

## Agendamento

`.github/workflows/automacoes.yml` roda tudo no GitHub Actions (grátis): alertas todo dia às 08h, triagem a cada 3 horas e relatório no dia 1º. Cadastre em *Settings → Secrets and variables → Actions*: `DATABASE_URL` (obrigatório), `AI_API_KEY` (ou `ANTHROPIC_API_KEY`), `SMTP_*`, `MAIL_TO`, `ALERT_WEBHOOK_URL`. Qualquer tarefa também pode ser disparada à mão na aba Actions.

## Testes

```bash
python -m pytest
```
