-- Supabaseの「SQL Editor」にこの内容を貼り付けて実行してください。

create table if not exists submissions (
  id bigint generated always as identity primary key,
  date date not null,
  time timestamptz not null,
  subject text not null,
  task text not null,
  type text not null, -- 'work-photo' | 'vocab-quiz' | 'kanji-quiz' | 'prep-quiz'
  photo text default '',
  marks jsonb default '{}',            -- work-photo用: {"1":"○","2":"✕"}
  explanations jsonb default '{}',     -- work-photo用: {"2":"解説文"}
  retry_problems jsonb default '{}',   -- work-photo用: {"2":"類似問題文"}
  retry_resolved jsonb default '{}',   -- work-photo用: {"2":true}
  quiz_result jsonb default '{}',      -- quiz系用: {"total":5,"wrong":1,"items":[...]}
  created_at timestamptz not null default now()
);
create index if not exists submissions_date_idx on submissions (date);

create table if not exists plans (
  id bigint generated always as identity primary key,
  date date not null,
  subject text not null,
  task text not null,
  created_at timestamptz not null default now()
);
create index if not exists plans_date_idx on plans (date);

create table if not exists missed_reasons (
  date date primary key,
  reason text not null,
  updated_at timestamptz not null default now()
);
