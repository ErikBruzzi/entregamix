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

  Enquanto SUPABASE_URL estiver com o valor de exemplo abaixo, o app roda
  em MODO DEMONSTRAÇÃO: os dados ficam só na memória do navegador (somem
  ao recarregar a página), então você já pode clicar em tudo e ver o
  funcionamento antes de configurar o banco de verdade.
*/

window.APP_CONFIG = {
  SUPABASE_URL: "COLE_A_URL_DO_SEU_PROJETO_AQUI",
  SUPABASE_ANON_KEY: "COLE_SUA_CHAVE_ANON_PUBLIC_AQUI",
};
