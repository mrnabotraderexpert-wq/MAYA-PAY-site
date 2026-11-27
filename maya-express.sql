-- MAYA EXPRESS : vitrine du vendeur (catalogue), commandes clients, rattachées à l'abonnement (mayapay.license_ok).
-- Script DÉJÀ APPLIQUÉ sur le projet Supabase BOUTIKI (migration « maya_express »). À ne rejouer que sur un nouveau serveur.
-- Aucune table n'est lisible directement : seules les fonctions ci-dessous (SECURITY DEFINER) y accèdent.

create table if not exists mayapay.shops (
  id text primary key,
  key_hash text not null,
  name text not null check (char_length(name) between 1 and 40),
  phone_orange text check (phone_orange ~ '^[0-9]{8,10}$'),
  phone_moov text check (phone_moov ~ '^[0-9]{8,10}$'),
  photo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone_orange is not null or phone_moov is not null)
);
create table if not exists mayapay.shop_products (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null references mayapay.shops(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  price bigint not null check (price between 1 and 5000000),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists shop_products_shop_idx on mayapay.shop_products (shop_id, position);
create table if not exists mayapay.shop_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null references mayapay.shops(id) on delete cascade,
  link_id text not null,
  buyer_name text not null,
  buyer_phone text not null,
  items jsonb not null,
  total bigint not null check (total between 1 and 5000000),
  created_at timestamptz not null default now()
);
create index if not exists shop_orders_shop_idx on mayapay.shop_orders (shop_id, created_at desc);
alter table mayapay.shops enable row level security;
alter table mayapay.shop_products enable row level security;
alter table mayapay.shop_orders enable row level security;
revoke all on mayapay.shops, mayapay.shop_products, mayapay.shop_orders from public, anon, authenticated;

-- 1) Le vendeur crée ou met à jour sa vitrine (licence obligatoire, comme pour les liens de paiement).
create or replace function public.mayapay_express_save(
  p_id text, p_key text, p_name text, p_orange text, p_moov text, p_photo text, p_products jsonb)
returns json language plpgsql security definer set search_path to '' as $$
declare
  v_id text; v_key text; v_n int; i int := 0; e jsonb; v_pn text; v_pp bigint;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', ' ', 'g'));
  v_po text := nullif(btrim(coalesce(p_orange, '')), '');
  v_pm text := nullif(btrim(coalesce(p_moov, '')), '');
  v_photo text := nullif(btrim(coalesce(p_photo, '')), '');
begin
  if char_length(v_name) not between 1 and 40 then raise exception 'invalid_name'; end if;
  if v_po is null and v_pm is null then raise exception 'invalid_number'; end if;
  if v_po is not null and v_po !~ '^[0-9]{8,10}$' then raise exception 'invalid_number'; end if;
  if v_pm is not null and v_pm !~ '^[0-9]{8,10}$' then raise exception 'invalid_number'; end if;
  if v_photo is not null and (char_length(v_photo) > 70000 or v_photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then raise exception 'invalid_photo'; end if;
  if p_products is null or jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) not between 1 and 30 then raise exception 'invalid_products'; end if;
  if not mayapay.license_ok(array[v_po, v_pm]) then raise exception 'license_required'; end if;
  if p_id is null then
    select count(*) into v_n from mayapay.shops s
     where s.created_at > now() - interval '1 hour' and (s.phone_orange = v_po or s.phone_moov = v_pm);
    if v_n >= 5 then raise exception 'rate_limited'; end if;
    v_id  := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    v_key := replace(gen_random_uuid()::text, '-', '');
    insert into mayapay.shops (id, key_hash, name, phone_orange, phone_moov, photo) values (v_id, md5(v_key), v_name, v_po, v_pm, v_photo);
  else
    perform 1 from mayapay.shops s where s.id = p_id and md5(coalesce(p_key, '')) = s.key_hash;
    if not found then raise exception 'forbidden'; end if;
    v_id := p_id; v_key := p_key;
    update mayapay.shops set name = v_name, phone_orange = v_po, phone_moov = v_pm, photo = v_photo, updated_at = now() where id = v_id;
    delete from mayapay.shop_products where shop_id = v_id;
  end if;
  for e in select value from jsonb_array_elements(p_products) loop
    i := i + 1;
    v_pn := btrim(regexp_replace(coalesce(e->>'n', ''), '[[:cntrl:]]', ' ', 'g'));
    if char_length(v_pn) not between 1 and 40 then raise exception 'invalid_product'; end if;
    if coalesce(e->>'p', '') !~ '^[0-9]{1,7}$' then raise exception 'invalid_product'; end if;
    v_pp := (e->>'p')::bigint;
    if v_pp not between 1 and 5000000 then raise exception 'invalid_product'; end if;
    insert into mayapay.shop_products (shop_id, name, price, position) values (v_id, v_pn, v_pp, i);
  end loop;
  return json_build_object('id', v_id, 'key', v_key);
end $$;

-- 2) Page publique du client : jamais les numéros du vendeur.
create or replace function public.mayapay_express_get(p_id text)
returns json language sql stable security definer set search_path to '' as $$
  select json_build_object(
    'n', s.name, 'p', s.photo,
    'open', mayapay.license_ok(array[s.phone_orange, s.phone_moov]),
    'ops', array_remove(array[case when s.phone_orange is not null then 'orange' end, case when s.phone_moov is not null then 'moov' end], null),
    'products', coalesce((select json_agg(json_build_object('id', p.id, 'n', p.name, 'p', p.price) order by p.position)
                          from mayapay.shop_products p where p.shop_id = s.id), '[]'::json))
  from mayapay.shops s where s.id = p_id;
$$;

-- 3) Le client valide son panier : total recalculé ICI avec les prix du serveur, puis lien de paiement MAYA-PAY (24 h).
create or replace function public.mayapay_express_order(p_id text, p_items jsonb, p_buyer text, p_phone text)
returns json language plpgsql security definer set search_path to '' as $$
declare
  s mayapay.shops%rowtype; r record; v_n int; v_total bigint := 0; v_det text := ''; v_items jsonb := '[]'::jsonb;
  v_res json; v_link text;
  v_buyer text := btrim(regexp_replace(coalesce(p_buyer, ''), '[[:cntrl:]]', ' ', 'g'));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  select * into s from mayapay.shops where id = p_id;
  if not found then raise exception 'shop_not_found'; end if;
  if char_length(v_buyer) not between 2 and 40 then raise exception 'invalid_buyer'; end if;
  if length(v_phone) > 10 and v_phone like '223%' then v_phone := substr(v_phone, 4); end if;
  if v_phone !~ '^[0-9]{8,10}$' then raise exception 'invalid_phone'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'invalid_cart'; end if;
  if not mayapay.license_ok(array[s.phone_orange, s.phone_moov]) then raise exception 'license_required'; end if;
  select count(*) into v_n from mayapay.shop_orders where shop_id = s.id and created_at > now() - interval '1 hour';
  if v_n >= 20 then raise exception 'rate_limited'; end if;
  for r in
    select pr.id pid, pr.name, pr.price, sum(i.q)::int q
    from (select e->>'id' as sid,
                 case when coalesce(e->>'q', '') ~ '^[0-9]{1,3}$' then (e->>'q')::int else 0 end as q
          from jsonb_array_elements(p_items) e) i
    left join mayapay.shop_products pr on pr.id::text = i.sid and pr.shop_id = s.id
    group by pr.id, pr.name, pr.price, pr.position
    order by pr.position nulls last
  loop
    if r.name is null or r.q < 1 or r.q > 99 then raise exception 'invalid_cart'; end if;
    v_total := v_total + r.price * r.q;
    v_det := v_det || r.q || 'x ' || r.name || ', ';
    v_items := v_items || jsonb_build_object('n', r.name, 'q', r.q, 'p', r.price);
  end loop;
  if v_total not between 1 and 5000000 then raise exception 'invalid_cart'; end if;
  v_res := public.mayapay_create_v3(s.name, s.phone_orange, s.phone_moov, v_total, left('Commande : ' || rtrim(v_det, ', '), 120), 24, s.photo);
  v_link := v_res->>'id';
  insert into mayapay.shop_orders (shop_id, link_id, buyer_name, buyer_phone, items, total) values (s.id, v_link, v_buyer, v_phone, v_items, v_total);
  delete from mayapay.shop_orders where created_at < now() - interval '90 days';   -- conservation limitée à 90 jours
  return json_build_object('id', v_link);
end $$;

-- 4) Le vendeur (clé secrète) voit ses commandes, avec l'état du paiement vérifié par SMS.
create or replace function public.mayapay_express_orders(p_id text, p_key text)
returns json language plpgsql stable security definer set search_path to '' as $$
declare s mayapay.shops%rowtype;
begin
  select * into s from mayapay.shops where id = p_id;
  if not found or md5(coalesce(p_key, '')) <> s.key_hash then raise exception 'forbidden'; end if;
  return json_build_object('n', s.name, 'orders', coalesce((
    select json_agg(x order by x.at desc) from (
      select o.id, o.link_id as link, o.buyer_name as buyer, o.buyer_phone as phone, o.items, o.total, o.created_at as at,
             (select l.expires_at from mayapay.links l where l.id = o.link_id) as exp,
             case when exists (select 1 from mayapay.proofs p where p.link_id = o.link_id and p.status = 'confirmed') then 'confirmed'
                  when exists (select 1 from mayapay.proofs p where p.link_id = o.link_id and p.status = 'check') then 'check'
                  else 'pending' end as status
      from mayapay.shop_orders o where o.shop_id = s.id order by o.created_at desc limit 50) x), '[]'::json));
end $$;

revoke all on function public.mayapay_express_save(text, text, text, text, text, text, jsonb) from public;
revoke all on function public.mayapay_express_get(text) from public;
revoke all on function public.mayapay_express_order(text, jsonb, text, text) from public;
revoke all on function public.mayapay_express_orders(text, text) from public;
grant execute on function public.mayapay_express_save(text, text, text, text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.mayapay_express_get(text) to anon, authenticated, service_role;
grant execute on function public.mayapay_express_order(text, jsonb, text, text) to anon, authenticated, service_role;
grant execute on function public.mayapay_express_orders(text, text) to anon, authenticated, service_role;
