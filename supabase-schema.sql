-- ============================================================
-- ENTREGAMIX — schema completo (pode rodar de novo com segurança
-- mesmo se você já rodou uma versão anterior deste arquivo)
-- Rode em: Supabase > SQL Editor > New query > Run
-- ============================================================

-- ------------------------------------------------------------
-- TABELAS
-- ------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text,
  address text,
  role text not null default 'cliente', -- cliente | restaurante | entregador
  created_at timestamp with time zone default now()
);
alter table profiles add column if not exists role text not null default 'cliente';
alter table profiles add column if not exists city text;

create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete set null,
  name text not null,
  category text,
  address text,
  eta_minutes int default 30,
  delivery_fee numeric(10,2) default 0,
  active boolean default true,
  created_at timestamp with time zone default now()
);
alter table restaurants add column if not exists owner_id uuid references auth.users (id) on delete set null;
alter table restaurants add column if not exists address text;
alter table restaurants add column if not exists city text;
alter table restaurants add column if not exists lat double precision;
alter table restaurants add column if not exists lng double precision;
alter table restaurants add column if not exists delivery_base_fee numeric(10,2) default 5.00;
alter table restaurants add column if not exists delivery_price_per_km numeric(10,2) default 1.50;
comment on column restaurants.delivery_fee is 'Coluna antiga (taxa fixa). Substituída por delivery_base_fee + delivery_price_per_km, calculados por distância. Mantida só por compatibilidade.';

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants (id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null,
  available boolean default true,
  image_url text,
  created_at timestamp with time zone default now()
);
alter table menu_items add column if not exists available boolean default true;
alter table menu_items add column if not exists image_url text;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  restaurant_id uuid references restaurants (id),
  courier_id uuid references auth.users (id) on delete set null,
  pickup_code text,
  address text, -- endereço de ENTREGA (do cliente)
  total numeric(10,2) not null,
  status text not null default 'recebido',
  -- status possíveis: recebido | preparando | pronto | a_caminho | entregue | cancelado
  created_at timestamp with time zone default now()
);
alter table orders add column if not exists courier_id uuid references auth.users (id) on delete set null;
alter table orders add column if not exists pickup_code text;
alter table orders add column if not exists food_subtotal numeric(10,2);
alter table orders add column if not exists delivery_fee numeric(10,2);
alter table orders add column if not exists delivery_distance_km numeric(10,2);
alter table orders add column if not exists delivery_city text;
comment on column orders.delivery_fee is 'Valor calculado por distância, exclusivo da entrega — é este valor (não o total) que será repassado ao entregador quando o pagamento for implementado.';

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders (id) on delete cascade,
  menu_item_id uuid references menu_items (id),
  name text not null,
  price numeric(10,2) not null,
  quantity int not null default 1
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders (id) on delete cascade,
  channel text not null check (channel in ('restaurante', 'entregador')),
  sender_id uuid references auth.users (id),
  sender_role text not null check (sender_role in ('cliente', 'restaurante', 'entregador')),
  content text not null,
  created_at timestamp with time zone default now()
);

-- ------------------------------------------------------------
-- TOKENS DE UPLOAD DE IMAGEM
-- Contorna um problema específico deste projeto onde o Storage não
-- consegue reconhecer auth.uid() do usuário logado (mesmo com um token
-- válido, que funciona normalmente no resto do app). Em vez da política
-- do Storage tentar identificar quem está enviando o arquivo, o app pede
-- um "código de permissão" de uso único ANTES de enviar a foto — a
-- criação desse código passa pela verificação normal de dono (que
-- funciona), e o Storage só precisa confirmar que o código existe e é
-- recente, sem depender de reconhecer o usuário.
-- ------------------------------------------------------------
create table if not exists upload_tokens (
  token uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants (id) on delete cascade,
  created_at timestamp with time zone default now()
);
alter table upload_tokens enable row level security;

drop policy if exists "dono gera token para seu restaurante" on upload_tokens;
create policy "dono gera token para seu restaurante" on upload_tokens
  for insert with check (
    exists (select 1 from restaurants r where r.id = restaurant_id and r.owner_id = auth.uid())
  );

drop policy if exists "qualquer um pode conferir um token" on upload_tokens;
create policy "qualquer um pode conferir um token" on upload_tokens
  for select using (true);

-- ------------------------------------------------------------
-- SEGURANÇA (Row Level Security)
-- ------------------------------------------------------------
alter table profiles enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table restaurants enable row level security;
alter table menu_items enable row level security;
alter table messages enable row level security;

-- PROFILES
drop policy if exists "usuário lê seu próprio perfil" on profiles;
create policy "usuário lê seu próprio perfil" on profiles
  for select using (auth.uid() = id);

drop policy if exists "usuário edita seu próprio perfil" on profiles;
create policy "usuário edita seu próprio perfil" on profiles
  for update using (auth.uid() = id);

drop policy if exists "usuário cria seu próprio perfil" on profiles;
create policy "usuário cria seu próprio perfil" on profiles
  for insert with check (auth.uid() = id);

-- RESTAURANTS
drop policy if exists "qualquer um lê restaurantes ativos" on restaurants;
create policy "qualquer um lê restaurantes ativos" on restaurants
  for select using (active = true);

drop policy if exists "dono vê seu restaurante mesmo inativo" on restaurants;
create policy "dono vê seu restaurante mesmo inativo" on restaurants
  for select using (owner_id = auth.uid());

drop policy if exists "dono cria seu restaurante" on restaurants;
create policy "dono cria seu restaurante" on restaurants
  for insert with check (owner_id = auth.uid());

drop policy if exists "dono edita seu restaurante" on restaurants;
create policy "dono edita seu restaurante" on restaurants
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- MENU_ITEMS
drop policy if exists "qualquer um lê o cardápio" on menu_items;
create policy "qualquer um lê o cardápio" on menu_items
  for select using (true);

drop policy if exists "dono gerencia seu cardápio" on menu_items;
create policy "dono gerencia seu cardápio" on menu_items
  for all using (
    exists (select 1 from restaurants r where r.id = menu_items.restaurant_id and r.owner_id = auth.uid())
  ) with check (
    exists (select 1 from restaurants r where r.id = menu_items.restaurant_id and r.owner_id = auth.uid())
  );

-- ORDERS
drop policy if exists "usuário lê seus próprios pedidos" on orders;
create policy "usuário lê seus próprios pedidos" on orders
  for select using (auth.uid() = user_id);

drop policy if exists "usuário cria seus próprios pedidos" on orders;
create policy "usuário cria seus próprios pedidos" on orders
  for insert with check (auth.uid() = user_id);

drop policy if exists "dono do restaurante lê pedidos do seu restaurante" on orders;
create policy "dono do restaurante lê pedidos do seu restaurante" on orders
  for select using (
    exists (select 1 from restaurants r where r.id = orders.restaurant_id and r.owner_id = auth.uid())
  );

drop policy if exists "dono do restaurante atualiza pedidos do seu restaurante" on orders;
create policy "dono do restaurante atualiza pedidos do seu restaurante" on orders
  for update using (
    exists (select 1 from restaurants r where r.id = orders.restaurant_id and r.owner_id = auth.uid())
  ) with check (
    exists (select 1 from restaurants r where r.id = orders.restaurant_id and r.owner_id = auth.uid())
  );

drop policy if exists "entregador vê pedidos disponíveis e os seus" on orders;
create policy "entregador vê pedidos disponíveis e os seus" on orders
  for select using (
    (
      status = 'pronto'
      and courier_id is null
      and exists (
        select 1
        from restaurants r
        join profiles p on p.id = auth.uid()
        where r.id = orders.restaurant_id
          and p.city is not null
          and r.city is not null
          and lower(trim(r.city)) = lower(trim(p.city))
      )
    )
    or courier_id = auth.uid()
  );

-- Esta política permite tanto o "aceite" (courier_id estava nulo, passa a ser o entregador)
-- quanto as atualizações seguintes (já sendo o dono do pedido). O UPDATE só funciona de
-- verdade se a condição USING bater no momento exato da escrita — por isso dois
-- entregadores nunca conseguem aceitar o mesmo pedido ao mesmo tempo.
drop policy if exists "entregador aceita e atualiza seus pedidos" on orders;
create policy "entregador aceita e atualiza seus pedidos" on orders
  for update using (
    (
      courier_id is null
      and exists (
        select 1
        from restaurants r
        join profiles p on p.id = auth.uid()
        where r.id = orders.restaurant_id
          and p.city is not null
          and r.city is not null
          and lower(trim(r.city)) = lower(trim(p.city))
      )
    )
    or courier_id = auth.uid()
  ) with check (
    courier_id = auth.uid()
  );

-- ORDER_ITEMS
drop policy if exists "usuário lê itens dos próprios pedidos" on order_items;
create policy "usuário lê itens dos próprios pedidos" on order_items
  for select using (
    exists (select 1 from orders o where o.id = order_items.order_id and (
      o.user_id = auth.uid()
      or o.courier_id = auth.uid()
      or exists (select 1 from restaurants r where r.id = o.restaurant_id and r.owner_id = auth.uid())
    ))
  );

drop policy if exists "usuário cria itens dos próprios pedidos" on order_items;
create policy "usuário cria itens dos próprios pedidos" on order_items
  for insert with check (
    exists (select 1 from orders o where o.id = order_items.order_id and o.user_id = auth.uid())
  );

-- MESSAGES (chat)
-- Só quem faz parte do pedido pode ler: o cliente, o dono do restaurante,
-- e (só no canal "entregador") o entregador que aceitou aquela corrida.
drop policy if exists "participantes leem mensagens do pedido" on messages;
create policy "participantes leem mensagens do pedido" on messages
  for select using (
    exists (
      select 1 from orders o
      left join restaurants r on r.id = o.restaurant_id
      where o.id = messages.order_id
        and (
          o.user_id = auth.uid()
          or r.owner_id = auth.uid()
          or o.courier_id = auth.uid()
        )
    )
  );

drop policy if exists "participantes enviam mensagens do pedido" on messages;
create policy "participantes enviam mensagens do pedido" on messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from orders o
      left join restaurants r on r.id = o.restaurant_id
      where o.id = messages.order_id
        and (
          (channel = 'restaurante' and (o.user_id = auth.uid() or r.owner_id = auth.uid()))
          or (channel = 'entregador' and (o.user_id = auth.uid() or o.courier_id = auth.uid()))
        )
    )
  );

-- Liga a tabela ao Realtime, para as mensagens chegarem instantaneamente
-- sem precisar recarregar a página.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;

-- ------------------------------------------------------------
-- ARMAZENAMENTO DE IMAGENS DO CARDÁPIO
-- Bucket público (qualquer um pode ver a foto do prato), mas só o dono
-- do restaurante pode enviar/trocar/excluir fotos dele. A pasta de cada
-- arquivo começa com o id do restaurante (ex.: "abc123/1699999999.jpg"),
-- e é isso que a política usa para conferir o dono.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

drop policy if exists "leitura pública das imagens do cardápio" on storage.objects;
create policy "leitura pública das imagens do cardápio" on storage.objects
  for select using (bucket_id = 'menu-images');

drop policy if exists "dono envia imagens do seu restaurante" on storage.objects;
create policy "dono envia imagens do seu restaurante" on storage.objects
  for insert with check (
    bucket_id = 'menu-images'
    and exists (
      select 1 from upload_tokens t
      where t.token::text = (storage.foldername(name))[1]
        and t.created_at > now() - interval '10 minutes'
    )
  );

drop policy if exists "dono atualiza imagens do seu restaurante" on storage.objects;
create policy "dono atualiza imagens do seu restaurante" on storage.objects
  for update using (
    bucket_id = 'menu-images'
    and exists (
      select 1 from upload_tokens t
      where t.token::text = (storage.foldername(name))[1]
        and t.created_at > now() - interval '10 minutes'
    )
  );

drop policy if exists "dono exclui imagens do seu restaurante" on storage.objects;
create policy "dono exclui imagens do seu restaurante" on storage.objects
  for delete using (
    bucket_id = 'menu-images'
    and exists (
      select 1 from upload_tokens t
      where t.token::text = (storage.foldername(name))[1]
        and t.created_at > now() - interval '10 minutes'
    )
  );

-- ------------------------------------------------------------
-- CONFIGURAÇÕES DA PLATAFORMA
-- Uma única linha com os parâmetros gerais do app. A taxa de comissão
-- (usada futuramente na integração com o Mercado Pago) fica aqui — para
-- mudá-la, basta rodar, por exemplo:
--   update platform_settings set commission_percent = 12 where id = true;
-- Não precisa mexer em nenhum outro lugar do sistema.
-- ------------------------------------------------------------
create table if not exists platform_settings (
  id boolean primary key default true check (id),
  commission_percent numeric(5,2) not null default 10.00, -- % sobre o valor da comida
  commission_fixed numeric(10,2) not null default 0.00,   -- valor fixo somado por pedido, se quiser usar
  updated_at timestamp with time zone default now()
);
insert into platform_settings (id) values (true) on conflict (id) do nothing;
alter table platform_settings enable row level security;
drop policy if exists "qualquer um lê as configurações da plataforma" on platform_settings;
create policy "qualquer um lê as configurações da plataforma" on platform_settings
  for select using (true);
-- Não existe política de update para o público de propósito: por enquanto,
-- a alteração é feita por você mesmo via SQL Editor (com privilégio total).
-- Se no futuro você quiser um painel para isso, me avise.

-- ------------------------------------------------------------
-- CRIAÇÃO AUTOMÁTICA DE PERFIL (E RESTAURANTE, SE FOR O CASO)
-- Roda dentro do banco com privilégio elevado, então funciona mesmo
-- antes da confirmação de e-mail.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_role text;
  chosen_city text;
begin
  chosen_role := coalesce(new.raw_user_meta_data->>'role', 'cliente');
  chosen_city := nullif(new.raw_user_meta_data->>'city', '');

  insert into public.profiles (id, name, email, phone, role, city)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', ''),
    chosen_role,
    chosen_city
  )
  on conflict (id) do nothing;

  if chosen_role = 'restaurante' then
    insert into public.restaurants (owner_id, name, category, city, eta_minutes, delivery_fee, active)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data->>'name', ''), 'Meu restaurante'),
      'Geral',
      chosen_city,
      30,
      0,
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- Dados de exemplo (só insere se a tabela ainda estiver vazia,
-- para não duplicar caso você rode este arquivo de novo)
-- ------------------------------------------------------------
insert into restaurants (name, category, eta_minutes, delivery_fee, address)
select 'Sabor da Vila', 'Brasileira', 35, 6.90, 'Rua das Flores, 120 - Centro'
where not exists (select 1 from restaurants);
