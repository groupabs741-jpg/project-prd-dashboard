
CREATE TABLE public.gold_prices (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  material_type text NOT NULL,
  weight numeric(8,3) NOT NULL,
  sell_price numeric(15,2) NOT NULL,
  buyback_price numeric(15,2) NOT NULL,
  spread numeric(15,2) GENERATED ALWAYS AS (sell_price - buyback_price) STORED,
  recorded_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gold_prices_unique_per_day UNIQUE (source, material_type, weight, recorded_date)
);

CREATE INDEX idx_gold_prices_lookup ON public.gold_prices (source, material_type, weight, recorded_date DESC);
CREATE INDEX idx_gold_prices_date ON public.gold_prices (recorded_date DESC);

GRANT SELECT ON public.gold_prices TO anon;
GRANT SELECT ON public.gold_prices TO authenticated;
GRANT ALL ON public.gold_prices TO service_role;

ALTER TABLE public.gold_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read gold prices"
  ON public.gold_prices FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE public.sync_runs (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'error')),
  item_count integer NOT NULL DEFAULT 0,
  error_message text,
  ran_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_runs_ran_at ON public.sync_runs (ran_at DESC);

GRANT SELECT ON public.sync_runs TO anon;
GRANT SELECT ON public.sync_runs TO authenticated;
GRANT ALL ON public.sync_runs TO service_role;

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read sync runs"
  ON public.sync_runs FOR SELECT
  TO anon, authenticated
  USING (true);
