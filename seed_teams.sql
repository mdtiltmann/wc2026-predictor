-- ─── WC2026 — Seed 48 Teams ───────────────────────────────────────────────────
-- Run in: Supabase Dashboard → SQL Editor → New query → Run

insert into public.teams (name, code, flag_url) values

-- CONMEBOL (6)
('Argentina',             'ARG', 'https://flagcdn.com/w40/ar.png'),
('Brazil',                'BRA', 'https://flagcdn.com/w40/br.png'),
('Colombia',              'COL', 'https://flagcdn.com/w40/co.png'),
('Uruguay',               'URU', 'https://flagcdn.com/w40/uy.png'),
('Ecuador',               'ECU', 'https://flagcdn.com/w40/ec.png'),
('Venezuela',             'VEN', 'https://flagcdn.com/w40/ve.png'),

-- CONCACAF (6)
('United States',         'USA', 'https://flagcdn.com/w40/us.png'),
('Mexico',                'MEX', 'https://flagcdn.com/w40/mx.png'),
('Canada',                'CAN', 'https://flagcdn.com/w40/ca.png'),
('Panama',                'PAN', 'https://flagcdn.com/w40/pa.png'),
('Costa Rica',            'CRC', 'https://flagcdn.com/w40/cr.png'),
('Honduras',              'HON', 'https://flagcdn.com/w40/hn.png'),

-- UEFA (16)
('Germany',               'GER', 'https://flagcdn.com/w40/de.png'),
('France',                'FRA', 'https://flagcdn.com/w40/fr.png'),
('Spain',                 'ESP', 'https://flagcdn.com/w40/es.png'),
('England',               'ENG', 'https://flagcdn.com/w40/gb-eng.png'),
('Portugal',              'POR', 'https://flagcdn.com/w40/pt.png'),
('Netherlands',           'NED', 'https://flagcdn.com/w40/nl.png'),
('Belgium',               'BEL', 'https://flagcdn.com/w40/be.png'),
('Switzerland',           'SUI', 'https://flagcdn.com/w40/ch.png'),
('Croatia',               'CRO', 'https://flagcdn.com/w40/hr.png'),
('Denmark',               'DEN', 'https://flagcdn.com/w40/dk.png'),
('Austria',               'AUT', 'https://flagcdn.com/w40/at.png'),
('Scotland',              'SCO', 'https://flagcdn.com/w40/gb-sct.png'),
('Turkey',                'TUR', 'https://flagcdn.com/w40/tr.png'),
('Slovakia',              'SVK', 'https://flagcdn.com/w40/sk.png'),
('Serbia',                'SRB', 'https://flagcdn.com/w40/rs.png'),
('Ukraine',               'UKR', 'https://flagcdn.com/w40/ua.png'),

-- AFC (8)
('Japan',                 'JPN', 'https://flagcdn.com/w40/jp.png'),
('South Korea',           'KOR', 'https://flagcdn.com/w40/kr.png'),
('Australia',             'AUS', 'https://flagcdn.com/w40/au.png'),
('Iran',                  'IRN', 'https://flagcdn.com/w40/ir.png'),
('Saudi Arabia',          'SAU', 'https://flagcdn.com/w40/sa.png'),
('Qatar',                 'QAT', 'https://flagcdn.com/w40/qa.png'),
('Iraq',                  'IRQ', 'https://flagcdn.com/w40/iq.png'),
('Jordan',                'JOR', 'https://flagcdn.com/w40/jo.png'),

-- CAF (9)
('Morocco',               'MAR', 'https://flagcdn.com/w40/ma.png'),
('Nigeria',               'NGA', 'https://flagcdn.com/w40/ng.png'),
('Senegal',               'SEN', 'https://flagcdn.com/w40/sn.png'),
('Egypt',                 'EGY', 'https://flagcdn.com/w40/eg.png'),
('South Africa',          'RSA', 'https://flagcdn.com/w40/za.png'),
('Ivory Coast',           'CIV', 'https://flagcdn.com/w40/ci.png'),
('DR Congo',              'COD', 'https://flagcdn.com/w40/cd.png'),
('Algeria',               'ALG', 'https://flagcdn.com/w40/dz.png'),
('Tunisia',               'TUN', 'https://flagcdn.com/w40/tn.png'),

-- OFC (1)
('New Zealand',           'NZL', 'https://flagcdn.com/w40/nz.png'),

-- Intercontinental playoffs (2)
('Paraguay',              'PRY', 'https://flagcdn.com/w40/py.png'),
('Uzbekistan',            'UZB', 'https://flagcdn.com/w40/uz.png')

on conflict (code) do nothing;
