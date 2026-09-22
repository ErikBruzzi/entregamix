/*
  CONFIGURAÇÃO DO ENTREGAMIX
  --------------------------
  Este é o ÚNICO arquivo que você precisa editar para ligar o app ao seu
  projeto Supabase.

  Como conseguir esses valores:
  1. Acesse https://supabase.com e crie (ou abra) seu projeto.
  2. Vá em "Project Settings" > "API".
  3. Copie o campo "Project URL" e cole em SUPABASE_URL.
  4. Copie o campo "anon public" (chave pública) e cole em SUPABASE_ANON_KEY.
     -> NUNCA cole a chave "service_role" aqui, ela é secreta e não deve
        aparecer em código que roda no navegador.
  5. Rode o arquivo supabase-schema.sql no "SQL Editor" do Supabase para
     criar as tabelas que o app espera.
  6. Para o pagamento funcionar, cole também sua chave PÚBLICA do Mercado
     Pago (painel do Mercado Pago > Seu negócio > Configurações >
     Credenciais de produção (ou de teste) > "Public Key", começa com
     APP_USR- ou TEST-). Essa chave é segura para ficar aqui — ela só
     permite montar o formulário de pagamento no navegador, nunca
     movimentar dinheiro sozinha. O Access Token (a chave SECRETA) NUNCA
     vai aqui — ele fica guardado como "secret" (MP_ACCESS_TOKEN) dentro
     das Edge Functions do Supabase.

  Enquanto SUPABASE_URL estiver com o valor de exemplo abaixo, o app roda
  em MODO DEMONSTRAÇÃO: os dados ficam só na memória do navegador (somem
  ao recarregar a página), então você já pode clicar em tudo e ver o
  funcionamento antes de configurar o banco de verdade.
*/

window.APP_CONFIG = {
  SUPABASE_URL: "https://mmbbkryjddfklzepqqeq.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1tYmJrcnlqZGRma2x6ZXBxcWVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3MjIzMzgsImV4cCI6MjEwMjI5ODMzOH0.tNbFXIXrlpLkgA6JBXgIFYYFNM73lt_ikCqeWKYptFc",
  MP_PUBLIC_KEY: "APP_USR-c7106def-734d-42fe-8ed4-6673c32a9ad6",
};
