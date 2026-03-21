-- BlogCtl SaaS Schema
-- 멀티테넌트: 모든 테이블에 user_id + RLS

-- 1. 프로필 (auth.users 확장)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);

-- 새 사용자 가입 시 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. 블로그
create table public.blogs (
  id text not null, -- blog_id (e.g., 'jokelife', 'kyeyangdak')
  user_id uuid references auth.users on delete cascade not null,
  label text not null, -- 한국어 표시명
  url text, -- 블로그 URL
  platform text, -- tistory, naver, etc.
  url_pattern text, -- URL 감지용 패턴
  created_at timestamptz default now(),
  primary key (id, user_id)
);

alter table public.blogs enable row level security;
create policy "Users can manage own blogs" on public.blogs for all using (auth.uid() = user_id);

-- 3. 키워드
create table public.keywords (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  blog_id text not null,
  keyword text not null,
  category text,
  priority text default 'medium',
  status text default 'pending', -- pending, published, rejected
  note text,
  search_volume int,
  difficulty int,
  search_intent text,
  verified boolean default false,
  verified_at timestamptz,
  published_at timestamptz,
  -- prediction fields
  monthly_search int,
  expected_clicks_4w int,
  expected_impressions_4w int,
  expected_ctr numeric(5,2),
  expected_rank numeric(5,2),
  confidence text,
  created_at timestamptz default now()
);

alter table public.keywords enable row level security;
create policy "Users can manage own keywords" on public.keywords for all using (auth.uid() = user_id);

create index idx_keywords_blog on public.keywords (user_id, blog_id);
create index idx_keywords_status on public.keywords (user_id, status);

-- 4. 발행 로그
create table public.publish_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  blog_id text not null,
  slug text not null,
  title text not null,
  url text,
  category text,
  tags text[],
  status text default 'success',
  published_at timestamptz,
  search_console boolean default false,
  sns_shared boolean default false,
  created_at timestamptz default now()
);

alter table public.publish_logs enable row level security;
create policy "Users can manage own publish_logs" on public.publish_logs for all using (auth.uid() = user_id);

create index idx_publish_logs_blog on public.publish_logs (user_id, blog_id);
create index idx_publish_logs_date on public.publish_logs (user_id, published_at desc);

-- 5. 일일 측정
create table public.measurements (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete cascade not null,
  measured_at date not null,
  data jsonb not null, -- 측정 데이터 전체 (유연한 구조)
  created_at timestamptz default now()
);

alter table public.measurements enable row level security;
create policy "Users can manage own measurements" on public.measurements for all using (auth.uid() = user_id);

create index idx_measurements_date on public.measurements (user_id, measured_at desc);
