-- ============================================================
-- Migratie: mockup-templates voor wandklokken
--   clock = deze kamerfoto gebruiken voor de automatische foto's van wandklokken (tools/maker/clock_mockups.py):
--   het kader is de plaats van de klok op de muur; resultaat mockup_clock_4_<template>.jpg bij het model.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table mockup_templates add column if not exists clock boolean not null default false;
