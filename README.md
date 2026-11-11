# Meu Plantão — Radiologia

Aplicação web responsiva para técnicos de radiologia acompanharem plantões, atendimentos, horários, fotografias, justificativas e horas trabalhadas. Esta primeira etapa entrega a estrutura Angular e a tela inicial visual; os registros exibidos nela são dados demonstrativos.

## Tecnologias

- Angular 22 e TypeScript
- SCSS responsivo
- Supabase JS para a futura integração com Auth, PostgreSQL e Storage
- Git para versionamento

## Requisitos locais

- Node.js 22.12 ou mais recente
- npm 10 ou mais recente

## Executar localmente

```bash
npm install
npm start
```

O servidor de desenvolvimento informa o endereço local após iniciar.

## Configuração do Supabase

O app inicia sem conexão Supabase, em modo de demonstração. Para configurar uma instância própria, edite `public/supabase-config.js` com a URL do projeto e a chave pública `anon`/`publishable` fornecida pelo Supabase. Essa chave foi feita para uso no navegador; ela não concede acesso por si só e precisa ser protegida pelas políticas RLS que serão criadas na etapa de banco e segurança.

Nunca coloque `service_role`, senhas ou tokens privados neste arquivo, no código Angular ou no Git. Não há dependência de serviço pago configurada pelo projeto.

## Estrutura principal

```text
src/app/core/       configuração e serviços compartilhados
src/app/features/   funcionalidades do produto (a desenvolver por etapas)
public/images/      recursos visuais locais
public/             recursos estáticos e configuração de runtime
supabase/           migrações do banco e políticas (próxima etapa)
```

O fuso padrão de apresentação será `America/Sao_Paulo`. O modelo de dados deverá guardar instantes completos e contar intervalos sobrepostos uma única vez, sinalizando-os para conferência.

## Scripts disponíveis

- `npm start` — servidor de desenvolvimento
- `npm run build` — compilação de produção
- `npm test` — testes Angular (serão adicionados junto às funcionalidades)
