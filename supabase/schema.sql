-- 내 차 관리 앱 데이터베이스 설계
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하세요. (한 번만 실행)

-- 1) 표(테이블) 만들기 ------------------------------------------------

-- 사용자 1명당 차 1대 정보
create table public.cars (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name    text not null default '',
  plate   text not null default ''
);

-- 주유 기록
create table public.fuel_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date       date not null,
  odo        integer not null check (odo >= 0),
  liters     numeric(7,2) not null check (liters > 0),
  cost       integer not null check (cost >= 0),
  created_at timestamptz not null default now()
);

-- 정비 기록
create table public.service_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type       text not null,
  date       date not null,
  odo        integer not null check (odo >= 0),
  cost       integer not null check (cost >= 0),
  next_km    integer check (next_km >= 0),
  next_date  date,
  memo       text not null default '',
  created_at timestamptz not null default now()
);

create index on public.fuel_logs (user_id);
create index on public.service_logs (user_id);

-- 2) 보안 규칙(RLS) ---------------------------------------------------
-- 이게 가장 중요해요! "내 기록은 나만 읽고 쓸 수 있다"는 규칙입니다.
-- 앱 코드에 공개되는 키(anon key)로도 다른 사람의 데이터는 볼 수 없게 막아줍니다.

alter table public.cars         enable row level security;
alter table public.fuel_logs    enable row level security;
alter table public.service_logs enable row level security;

create policy "내 차만 접근" on public.cars
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "내 주유 기록만 접근" on public.fuel_logs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "내 정비 기록만 접근" on public.service_logs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
