# Carcará Tecnologia - Landing Page

[![Live Demo](https://img.shields.io/badge/demo-live-green.svg)](https://carcara-tech.vercel.app/)
![Status](https://img.shields.io/badge/status-active-blue.svg)

[Português](#português) | [English](#english)

---

## Português

### 🦅 Sobre a Carcará Tecnologia
A **Carcará Tecnologia** é uma software house localizada no Cariri (Ceará) focada em transformar processos complexos em sistemas simples de operar. Desenvolvemos soluções sob medida para empresas que buscam escala, eficiência operacional e segurança.

Este repositório contém o código-fonte da landing page institucional da Carcará Tecnologia.

### 🚀 Funcionalidades
- **Design Responsivo:** Adaptado para todos os tamanhos de tela (Bootstrap 5.3).
- **Animações Fluidas:** Efeitos de revelação ao rolar a página (Intersection Observer API).
- **Componentes Interativos:** Modal de detalhes de projetos, carrossel de depoimentos e contador de métricas.
- **Formulário de Contato:** Integrado com [FormSubmit](https://formsubmit.co/) para recebimento de leads.
- **Efeitos Visuais:** Cursor glow no hero, barra de progresso de leitura e partículas dinâmicas.

### 🛠️ Tecnologias Utilizadas
- **Linguagem:** HTML5, JavaScript (ES6+)
- **Estilização:** CSS3 (Variáveis nativas, Flexbox, Grid)
- **Framework:** [Bootstrap 5.3](https://getbootstrap.com/)
- **Ícones:** [Font Awesome](https://fontawesome.com/)
- **Fontes:** [Inter (Google Fonts)](https://fonts.google.com/specimen/Inter)

### 🔐 Painel de gestão (`/app`)
Área restrita com login para gerenciar **clientes, projetos, solicitações do site, financeiro e os cases exibidos na landing page** (aba *Cases*: criar, editar, ocultar, reordenar e enviar imagem). Os cards do `index.html` servem só de reserva caso a API esteja fora do ar. As solicitações enviadas pelo formulário da landing page também são gravadas no painel.

**Arquitetura:** landing + painel estáticos na **Vercel**, API Node/Express (`server/`) no **Render** e banco Postgres no **Neon**. A Vercel repassa `/api/*` para o Render (`vercel.json`), então o cookie de sessão é do mesmo domínio.

**Automações em Python** (`python/`): relatório mensal, alertas de cobrança, triagem de solicitações com IA, screenshots dos cases e um diagnóstico de sites. Veja [python/README.md](python/README.md).

**Rodar localmente**
```bash
cd server
cp .env.example .env      # preencha DATABASE_URL, JWT_SECRET, ADMIN_EMAIL e ADMIN_PASSWORD
npm install
npm start                 # http://localhost:3000 (landing) e /app (painel)
```
As tabelas e o usuário administrador são criados automaticamente na primeira execução.

**Publicar**
1. **Neon:** crie um projeto e copie a connection string.
2. **Render:** *New → Blueprint* apontando para este repositório (`render.yaml`). Informe `DATABASE_URL`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
3. **Vercel:** em `vercel.json`, troque `carcara-api-n4nq.onrender.com` pela URL real do serviço no Render e faça o deploy.

---

## English

### 🦅 About Carcará Tecnologia
**Carcará Tecnologia** is a software house located in Cariri (Ceará, Brazil) focused on transforming complex processes into simple-to-operate systems. We develop tailored solutions for companies looking for scale, operational efficiency, and security.

This repository contains the source code for Carcará Tecnologia's institutional landing page.

### 🚀 Features
- **Responsive Design:** Adapted for all screen sizes (Bootstrap 5.3).
- **Fluid Animations:** Reveal effects on scroll (Intersection Observer API).
- **Interactive Components:** Project details modal, testimonials carousel, and metrics counter.
- **Contact Form:** Integrated with [FormSubmit](https://formsubmit.co/) for lead generation.
- **Visual Effects:** Hero cursor glow, reading progress bar, and dynamic particles.

### 🛠️ Tech Stack
- **Languages:** HTML5, JavaScript (ES6+)
- **Styling:** CSS3 (Native variables, Flexbox, Grid)
- **Framework:** [Bootstrap 5.3](https://getbootstrap.com/)
- **Icons:** [Font Awesome](https://fontawesome.com/)
- **Fonts:** [Inter (Google Fonts)](https://fonts.google.com/specimen/Inter)

---

## 💻 Como Rodar / How to Run

1. Clone o repositório / Clone the repository:
   ```bash
   git clone https://github.com/ProfWashingtonAraujo/carcara.git
   ```
2. Abra o arquivo `index.html` em seu navegador / Open `index.html` in your browser.

## 📄 Licença / License
Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes. (Se aplicável)

---
Desenvolvido por **Carcará Tecnologia** 🦅
