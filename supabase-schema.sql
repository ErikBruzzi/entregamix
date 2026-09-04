-- ============================================================
-- ENTREGAMIX — schema inicial do Supabase
-- Rode este arquivo em: Supabase > SQL Editor > New query > Run
-- ============================================================

-- Perfis de usuário (clientes). Cada linha se conecta a um usuário
-- do sistema de autenticação do Supabase (auth.users).
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  address text,
  created_at timestamp with time zone default now()
);

-- Comércios/restaurantes associados ao app.
create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  eta_minutes int default 30,
  delivery_fee numeric(10,2) default 0,
  active boolean default true,
  created_at timestamp with time zone default now()
);

-- Itens de cardápio de cada restaurante.
create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants (id) on delete cascade,
  name text not null,
  description text,
  price numeric(10,2) not null,
  created_at timestamp with time zone default now()
);

-- Pedidos feitos pelos clientes.
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  restaurant_id uuid references restaurants (id),
  address text,
  total numeric(10,2) not null,
  status text not null default 'recebido', -- recebido | preparando | a_caminho | entregue | cancelado
  created_at timestamp with time zone default now()
);

-- Itens de cada pedido (histórico independente do cardápio atual).
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders (id) on delete cascade,
  menu_item_id uuid references menu_items (id),
  name text not null,
  price numeric(10,2) not null,
  quantity int not null default 1
);

-- ============================================================
-- SEGURANÇA (Row Level Security) — cada cliente só vê seus dados
-- ============================================================
alter table profiles enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table restaurants enable row level security;
alter table menu_items enable row level security;

create policy "usuário lê seu próprio perfil" on profiles
  for select using (auth.uid() = id);
create policy "usuário edita seu próprio perfil" on profiles
  for update using (auth.uid() = id);
create policy "usuário cria seu próprio perfil" on profiles
  for insert with check (auth.uid() = id);

create policy "usuário lê seus próprios pedidos" on orders
  for select using (auth.uid() = user_id);
create policy "usuário cria seus próprios pedidos" on orders
  for insert with check (auth.uid() = user_id);

create policy "usuário lê itens dos próprios pedidos" on order_items
  for select using (
    exists (select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid())
  );
create policy "usuário cria itens dos próprios pedidos" on order_items
  for insert with check (
    exists (select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid())
  );

-- Restaurantes e cardápio são públicos para leitura (qualquer visitante navega sem login).
create policy "qualquer um lê restaurantes ativos" on restaurants
  for select using (active = true);
create policy "qualquer um lê o cardápio" on menu_items
  for select using (true);

-- ============================================================
-- Dados de exemplo (opcional — apague se não quiser dados de teste)
-- ============================================================
insert into restaurants (name, category, eta_minutes, delivery_fee) values
  ('Sabor da Vila', 'Brasileira', 35, 6.90),
  ('Pizzaria Bella', 'Pizzas', 40, 8.50);
