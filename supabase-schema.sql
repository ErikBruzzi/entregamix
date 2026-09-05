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

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants (id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null,
  available boolean default true,
  created_at timestamp with time zone default now()
);
alter table menu_items add column if not exists available boolean default true;

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

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders (id) on delete cascade,
  menu_item_id uuid references menu_items (id),
  name text not null,
  price numeric(10,2) not null,
  quantity int not null default 1
);

-- ------------------------------------------------------------
-- SEGURANÇA (Row Level Security)
-- ------------------------------------------------------------
alter table profiles enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table restaurants enable row level security;
alter table menu_items enable row level security;

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
    (status = 'pronto' and courier_id is null) or courier_id = auth.uid()
  );

-- Esta política permite tanto o "aceite" (courier_id estava nulo, passa a ser o entregador)
-- quanto as atualizações seguintes (já sendo o dono do pedido). O UPDATE só funciona de
-- verdade se a condição USING bater no momento exato da escrita — por isso dois
-- entregadores nunca conseguem aceitar o mesmo pedido ao mesmo tempo.
drop policy if exists "entregador aceita e atualiza seus pedidos" on orders;
create policy "entregador aceita e atualiza seus pedidos" on orders
  for update using (
    courier_id is null or courier_id = auth.uid()
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
begin
  chosen_role := coalesce(new.raw_user_meta_data->>'role', 'cliente');

  insert into public.profiles (id, name, email, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', ''),
    chosen_role
  )
  on conflict (id) do nothing;

  if chosen_role = 'restaurante' then
    insert into public.restaurants (owner_id, name, category, eta_minutes, delivery_fee, active)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data->>'name', ''), 'Meu restaurante'),
      'Geral',
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
