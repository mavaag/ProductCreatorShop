-- ============================================================
-- Migratie: mockup-templates voor Wall Art
--   wall_art = deze (UV-)template gebruiken voor de automatische mockups van nieuwe Wall Art-posters:
--   wat je in _Inbox/UV/Wall-Art zet, plaatst de agent in elke aangevinkte template
--   (tools/maker/wallart_mockups.py) en bewaart het resultaat als mockup_<template>.jpg bij het ontwerp.
-- Voer dit uit in Supabase: Dashboard > SQL Editor > New query -- VOOR je de bijhorende PR merget.
-- Bewaart je bestaande data -- geen dataverlies.
-- ============================================================

alter table mockup_templates add column if not exists wall_art boolean not null default false;
