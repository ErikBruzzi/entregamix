# EntregaMix

App de delivery em HTML puro (sem framework, sem instalação), otimizado para
navegadores mobile, pronto para hospedar no GitHub + Netlify conforme o
planejamento.

## Arquivos

- `index.html` — app do cliente: busca restaurantes, cardápio, carrinho, checkout e pedidos.
- `dashboard.html` — dashboard de conta: dados pessoais e histórico de pedidos.
- `js/config.js` — **único arquivo que você precisa editar** com as credenciais do Supabase.
- `js/db-adapter.js` — camada de acesso a dados. Fala com o Supabase hoje; para trocar de banco no futuro, reescreva só este arquivo.
- `js/app.js` / `js/dashboard.js` — lógica de tela, não conhecem o Supabase diretamente.
- `supabase-schema.sql` — script para criar as tabelas no Supabase.

## Como colocar no ar

1. **Crie o projeto no Supabase**: em supabase.com, crie um projeto novo.
2. **Rode o schema**: abra "SQL Editor" no Supabase, cole o conteúdo de `supabase-schema.sql` e execute. Isso cria as tabelas `profiles`, `restaurants`, `menu_items`, `orders` e `order_items`, já com as regras de segurança (cada cliente só vê seus próprios pedidos).
3. **Configure as chaves**: em "Project Settings > API", copie a "Project URL" e a chave "anon public" para dentro de `js/config.js`.
4. **Cadastre seus comércios**: adicione linhas nas tabelas `restaurants` e `menu_items` pelo painel do Supabase (Table Editor) — é aí que entram os comércios associados do seu plano de marketing.
5. **Suba os arquivos no GitHub** e conecte o repositório à Netlify (como já está no seu planejamento) — não precisa de build, é só apontar a pasta raiz.

## Testando antes de configurar o Supabase

Se você abrir os arquivos sem preencher `js/config.js`, o app entra em
**modo demonstração** automaticamente (aparece um aviso na parte de baixo da
tela): dá para clicar em tudo, adicionar itens ao carrinho e simular um
pedido, mas nada fica salvo de verdade — é só para você aprovar a interface
antes de ligar o banco de dados real.

## Trocando de banco de dados no futuro

Todo o app conversa só com `window.DB` (definido em `js/db-adapter.js`).
Se um dia vocês quiserem sair do Supabase, criem um novo arquivo que
implemente as mesmas funções (`signIn`, `signUp`, `getRestaurants`,
`createOrder`, etc. — a lista completa está comentada no topo do arquivo) e
troquem só essa peça. `index.html`, `dashboard.html` e o restante do código
não precisam mudar.

## Próximos passos sugeridos

- Adicionar um painel para os comércios associados atualizarem o status dos pedidos (hoje isso fica pelo Table Editor do Supabase).
- Ligar o Google Ads / Meta Ads a páginas de destino específicas por comércio.
- Configurar e-mail e telefone de suporte próprios, como já está no planejamento de "Email, Contato & Suporte".
