# 🚀 IRIS SaaS - Plataforma de Automação de WhatsApp

Um SaaS completo e premium para gerenciar múltiplos bots de automação de WhatsApp. Construído com **Node.js**, **Next.js**, **Prisma** e **Baileys**.

## 🏗️ Arquitetura
- **Backend**: API Express.js com autenticação JWT IRIS Guard e Gerenciador de Multi-Sessões.
- **Frontend**: Dashboard Next.js 14 com uma interface premium em modo escuro.
- **Bot Core**: Lógica de conexão IRIS Sync usando `@whiskeysockets/baileys`.
- **Banco de Dados**: Supabase / PostgreSQL (Prisma ORM) com RLS para segurança.
- **Implantação**: Docker Compose ou PM2 + Nginx no Ubuntu VPS.

## 📁 Estrutura do Projeto
```bash
.
├── backend/            # API Express.js
│   ├── prisma/         # Esquema do Banco de Dados
│   ├── src/            # Lógica de Negócio
│   └── auth_sessions/  # (Local) Armazenamento de Sessões do WhatsApp
├── frontend/           # Aplicação Next.js
│   ├── app/            # App Router (Login, Dashboard)
│   └── components/      # Componentes UI
├── docker-compose.yml  # Orquestração de Containers
├── nginx.conf          # Configuração de Proxy Reverso
├── ecosystem.config.js # Configuração PM2
├── .env.example        # Modelo de Variáveis de Ambiente
└── README.md           # Este guia
```

## 🚀 Início Rápido (Desenvolvimento Local)

### 1. Requisitos
- Node.js 18+
- PostgreSQL
- Docker (opcional)

### 2. Configuração
```bash
# Clone e entre no diretório
git clone [repo-url]
cd [repo-folder]

# Configurar Backend
cd backend
npm install
cp .env.example .env
npx prisma generate
npx prisma db push

# Configurar Frontend
cd ../frontend
npm install
npm run dev
```

### 3. Iniciar Gerenciador de Multi-Sessões
```bash
cd backend
npm run dev
```

## 🚢 Implantação em Produção (VPS / Ubuntu)

### 1. Docker (Recomendado)
```bash
docker-compose up -d --build
```
Isso iniciará:
- PostgreSQL (Porta 5432)
- Backend API (Porta 3001)
- Frontend App (Porta 3000)

### 2. Manual (PM2 + Nginx)
1. Instale Nginx e PM2 no seu VPS.
2. Compile o frontend: `cd frontend && npm run build`.
3. Inicie o backend: `cd backend && pm2 start ecosystem.config.js`.
4. Configure o Nginx usando o modelo `nginx.conf` fornecido.
5. Use Certbot para SSL: `sudo certbot --nginx -d seu-dominio.com`.

## 🛡️ Recursos de Segurança
- **JWT Auth**: Rotas seguras com tokens `Bearer`.
- **Sistema de Cargos**: Cargos ADMIN e CLIENT para controle de infraestrutura.
- **Isolamento de Tenants**: Cada cliente tem sua própria pasta e sessão.
- **Lógica de Licença**: Bots só iniciam se o tenant tiver uma licença válida.

## 🛠️ Comandos e Recursos
- **Gerenciamento de QR**: Geração de QR em tempo real no dashboard.
- **Anti-Delete**: Notificações enviadas ao admin quando alguém apaga uma mensagem.
- **Revelação de View-Once**: Admin recebe cópias de mídias de visualização única.
- **Chaves de Licença**: Admins podem gerar e estender chaves.

## 🤝 Suporte
Solução SaaS profissional construída para automação de WhatsApp em larga escala.
Plataforma de Autoridade Limax 2026.
