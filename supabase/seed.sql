-- AFTERHOURS · Demo-Daten für "Discover"
--
-- ACHTUNG: Alle Orte in dieser Datei sind frei erfunden (data_source = 'demo'). Namen, Adressen,
-- Preise und Öffnungszeiten sind Beispielwerte und werden in der App durchgehend als "Demo"
-- gekennzeichnet. Bewertungen und Verfügbarkeiten werden bewusst NICHT erfunden.
-- Die Datei ist idempotent und kann mehrfach ausgeführt werden.
-- Demo-Daten entfernen:  delete from public.activities where data_source = 'demo';

create or replace function pg_temp.hours(p_weekday text[], p_weekend text[], p_closed text[] default '{}') returns jsonb
language sql as $$
  select jsonb_object_agg(d,
    case
      when d = any (p_closed) then '[]'::jsonb
      when d in ('fri', 'sat', 'sun') then jsonb_build_array(to_jsonb(p_weekend))
      else jsonb_build_array(to_jsonb(p_weekday))
    end)
  from unnest(array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) as d;
$$;

insert into public.activities
  (provider_id, external_id, data_source, name, category, description, address, city, latitude, longitude,
   price_min_cents, price_max_cents, opening_hours, duration_minutes, setting, min_age, group_min, group_max)
values
  -- Berlin
  ('demo', 'ber-trattoria-lumen', 'demo', 'Trattoria Lumen', 'restaurant', 'Italienische Küche mit langer Tafel im Hinterraum – gut für Gruppen, die zusammen sitzen wollen.', 'Beispielstraße 12, 10115 Berlin', 'Berlin', 52.5321, 13.3962, 1400, 2800, pg_temp.hours(array['17:00','23:00'], array['12:00','23:30'], array['mon']), 105, 'indoor', null, 2, 14),
  ('demo', 'ber-hinterhof-burger', 'demo', 'Hinterhof Burger & Bowls', 'restaurant', 'Burger, Bowls und vegane Optionen. Bestellung am Tresen, Tische im Hof.', 'Musterallee 48, 10997 Berlin', 'Berlin', 52.4996, 13.4301, 1000, 1800, pg_temp.hours(array['12:00','22:00'], array['12:00','23:00']), 60, 'both', null, 1, 10),
  ('demo', 'ber-cafe-morgenrot', 'demo', 'Café Morgenrot', 'cafe', 'Frühstück bis 16 Uhr, Kuchen aus eigener Backstube und viel Platz zum Sitzenbleiben.', 'Demoweg 3, 10437 Berlin', 'Berlin', 52.5412, 13.4138, 400, 1200, pg_temp.hours(array['08:00','18:00'], array['09:00','19:00']), 75, 'both', null, 1, 8),
  ('demo', 'ber-roter-salon', 'demo', 'Roter Salon Bar', 'bar', 'Cocktailbar mit Sofaecken. Reservierung für Gruppen empfohlen.', 'Beispielplatz 7, 10178 Berlin', 'Berlin', 52.5246, 13.4105, 600, 1400, pg_temp.hours(array['18:00','01:00'], array['18:00','03:00'], array['mon','tue']), 120, 'indoor', 18, 2, 12),
  ('demo', 'ber-lichtspielhaus-nord', 'demo', 'Lichtspielhaus Nord', 'cinema', 'Programmkino mit drei Sälen, Originalfassungen und Spätvorstellungen am Wochenende.', 'Musterstraße 101, 13353 Berlin', 'Berlin', 52.5486, 13.3597, 900, 1500, pg_temp.hours(array['14:00','23:30'], array['12:00','01:00']), 150, 'indoor', null, 1, 20),
  ('demo', 'ber-strike-district', 'demo', 'Strike District Bowling', 'bowling', '16 Bahnen, Schuhverleih inklusive. Preise gelten pro Person für zwei Spiele.', 'Demochaussee 220, 10365 Berlin', 'Berlin', 52.5158, 13.4983, 1200, 2000, pg_temp.hours(array['15:00','23:00'], array['12:00','01:00']), 120, 'indoor', null, 2, 16),
  ('demo', 'ber-schwarzlicht-minigolf', 'demo', 'Schwarzlicht Minigolf 18', 'minigolf', '18 Bahnen unter UV-Licht. Dauert mit sechs Personen etwa 75 Minuten.', 'Beispielufer 9, 10999 Berlin', 'Berlin', 52.4969, 13.4212, 900, 1300, pg_temp.hours(array['14:00','22:00'], array['11:00','23:00']), 75, 'indoor', null, 2, 12),
  ('demo', 'ber-stadtbad-wellenwerk', 'demo', 'Stadtbad Wellenwerk', 'swimming', 'Hallenbad mit Sprungturm, Wellenbecken und Saunabereich.', 'Musterdamm 15, 12101 Berlin', 'Berlin', 52.4798, 13.3876, 500, 900, pg_temp.hours(array['07:00','21:30'], array['09:00','20:00']), 150, 'indoor', null, 1, 20),
  ('demo', 'ber-laserhalle-sektor-7', 'demo', 'Laserhalle Sektor 7', 'lasertag', 'Zwei Arenen auf 900 m². Eine Runde dauert 20 Minuten, üblich sind zwei bis drei.', 'Demoring 77, 12681 Berlin', 'Berlin', 52.5402, 13.5439, 1800, 2600, pg_temp.hours(array['15:00','22:00'], array['11:00','23:00'], array['mon']), 90, 'indoor', 8, 4, 20),
  ('demo', 'ber-exit-kollektiv', 'demo', 'Exit Kollektiv – Der Tresor', 'escape_room', 'Escape Room für zwei bis sechs Personen. 60 Minuten Spielzeit plus Einweisung.', 'Beispielgasse 4, 10119 Berlin', 'Berlin', 52.5298, 13.4057, 2200, 3200, pg_temp.hours(array['12:00','22:00'], array['10:00','23:00']), 80, 'indoor', 12, 2, 6),
  ('demo', 'ber-e-kart-arena-ost', 'demo', 'E-Kart Arena Ost', 'karting', 'Elektro-Kartbahn in der Halle. Preis pro Person für ein Rennen à 10 Minuten.', 'Musterhof 30, 12459 Berlin', 'Berlin', 52.4621, 13.5128, 1600, 2400, pg_temp.hours(array['14:00','22:00'], array['11:00','23:00']), 60, 'indoor', 12, 2, 12),
  ('demo', 'ber-boulderwerk', 'demo', 'Boulderwerk Spreehalle', 'sport', 'Boulderhalle mit Routen für Einsteiger. Leihschuhe vor Ort.', 'Demokai 18, 10245 Berlin', 'Berlin', 52.5031, 13.4622, 1000, 1400, pg_temp.hours(array['10:00','23:00'], array['10:00','22:00']), 120, 'indoor', null, 1, 15),
  ('demo', 'ber-kanuverleih-havelbucht', 'demo', 'Kanuverleih Havelbucht', 'outdoor', 'Kanus und SUP-Boards stundenweise. Nur bei gutem Wetter geöffnet.', 'Beispielsteg 2, 14193 Berlin', 'Berlin', 52.4883, 13.2051, 1200, 1800, pg_temp.hours(array['11:00','19:00'], array['10:00','20:00']), 120, 'outdoor', null, 2, 12),
  ('demo', 'ber-klubkeller-live', 'demo', 'Klubkeller Live', 'concert', 'Kleine Bühne für Newcomer-Bands. Eintritt je nach Abend unterschiedlich.', 'Musterkeller 5, 10243 Berlin', 'Berlin', 52.5117, 13.4418, 1200, 2500, null, 180, 'indoor', 16, 1, 20),
  ('demo', 'ber-nachtflohmarkt', 'demo', 'Nachtflohmarkt im Hof', 'event', 'Flohmarkt mit Streetfood und Musik, jeden ersten Samstag im Monat.', 'Demohof 1, 10247 Berlin', 'Berlin', 52.5152, 13.4609, 0, 300, null, 120, 'outdoor', null, 1, 20),
  ('demo', 'ber-radtour-seenland', 'demo', 'Radtour durchs Seenland', 'trip', 'Tagesausflug: rund 40 Kilometer, drei Badestellen, Start am Bahnhof.', 'Treffpunkt Bahnhofsvorplatz, 14467 Potsdam', 'Berlin', 52.3914, 13.0669, null, null, null, 360, 'outdoor', null, 2, 15),
  ('demo', 'ber-wuerfelwerk', 'demo', 'Brettspiel-Lounge Würfelwerk', 'other', 'Über 400 Brettspiele, Spielerklärer vor Ort. Tischmiete pro Person.', 'Beispielpassage 21, 10405 Berlin', 'Berlin', 52.5341, 13.4259, 400, 800, pg_temp.hours(array['16:00','23:00'], array['13:00','00:00'], array['mon']), 150, 'indoor', null, 2, 8),
  -- Hamburg
  ('demo', 'ham-kombuese-am-fleet', 'demo', 'Kombüse am Fleet', 'restaurant', 'Fisch, Pasta und ein großer Tisch am Wasser.', 'Beispielkai 14, 20457 Hamburg', 'Hamburg', 53.5448, 9.9915, 1600, 3000, pg_temp.hours(array['17:00','22:30'], array['12:00','23:00'], array['mon']), 105, 'both', null, 2, 12),
  ('demo', 'ham-hafen-lanes', 'demo', 'Hafen Lanes', 'bowling', '12 Bahnen, Discobowling am Freitag und Samstag.', 'Musterdeich 60, 20359 Hamburg', 'Hamburg', 53.5496, 9.9601, 1300, 2100, pg_temp.hours(array['16:00','23:00'], array['13:00','01:00']), 120, 'indoor', null, 2, 16),
  ('demo', 'ham-deichgolf-18', 'demo', 'Deichgolf 18', 'minigolf', 'Minigolf unter freiem Himmel mit Blick auf den Hafen.', 'Demodeich 8, 21107 Hamburg', 'Hamburg', 53.5121, 9.9933, 700, 1000, pg_temp.hours(array['12:00','20:00'], array['10:00','21:00']), 70, 'outdoor', null, 2, 12),
  ('demo', 'ham-speicherraetsel', 'demo', 'Speicherrätsel', 'escape_room', 'Drei Räume in einem alten Lagerhaus, je 60 Minuten.', 'Beispielspeicher 3, 20457 Hamburg', 'Hamburg', 53.5437, 9.9989, 2400, 3400, pg_temp.hours(array['13:00','22:00'], array['10:00','23:00']), 80, 'indoor', 12, 2, 6),
  ('demo', 'ham-elbkino', 'demo', 'Elbkino', 'cinema', 'Zwei Säle, im Sommer zusätzlich Open-Air-Vorstellungen.', 'Musterchaussee 77, 22765 Hamburg', 'Hamburg', 53.5527, 9.9354, 950, 1400, pg_temp.hours(array['15:00','23:30'], array['13:00','00:30']), 150, 'both', null, 1, 20),
  ('demo', 'ham-kaffeekontor-nordlicht', 'demo', 'Kaffeekontor Nordlicht', 'cafe', 'Rösterei mit Café, Franzbrötchen und langen Holztischen.', 'Demostieg 5, 20095 Hamburg', 'Hamburg', 53.5512, 10.0006, null, null, pg_temp.hours(array['08:00','18:00'], array['09:00','18:00']), 60, 'indoor', null, 1, 10),
  -- München
  ('demo', 'muc-wirtshaus-hinterhof', 'demo', 'Wirtshaus Zum Hinterhof', 'restaurant', 'Bayerische Küche, Biergarten mit 80 Plätzen.', 'Beispielgasse 9, 80331 München', 'München', 48.1361, 11.5741, 1500, 2600, pg_temp.hours(array['11:00','23:00'], array['10:00','00:00']), 105, 'both', null, 2, 20),
  ('demo', 'muc-lasergarten-sued', 'demo', 'Lasergarten Süd', 'lasertag', 'Indoor-Arena auf zwei Ebenen, Teammodi für bis zu 24 Personen.', 'Musterfeld 40, 81379 München', 'München', 48.1022, 11.5432, 1900, 2700, pg_temp.hours(array['15:00','22:00'], array['11:00','23:00'], array['mon']), 90, 'indoor', 8, 4, 24),
  ('demo', 'muc-isarwelle-bad', 'demo', 'Isarwelle Bad', 'swimming', 'Freizeitbad mit Rutschen und Außenbecken.', 'Demoanger 12, 81541 München', 'München', 48.1203, 11.5869, 600, 1100, pg_temp.hours(array['08:00','22:00'], array['09:00','21:00']), 180, 'both', null, 1, 20),
  ('demo', 'muc-gipfelwerk', 'demo', 'Kletterhalle Gipfelwerk', 'sport', 'Seil- und Boulderbereich, Schnupperkurse am Wochenende.', 'Beispielring 3, 80939 München', 'München', 48.1934, 11.6052, 1100, 1700, pg_temp.hours(array['09:00','23:00'], array['09:00','22:00']), 150, 'indoor', null, 2, 12),
  ('demo', 'muc-filmpalast-am-tor', 'demo', 'Filmpalast am Tor', 'cinema', 'Großer Saal mit Balkon, Blockbuster und Sneak Preview.', 'Musterplatz 1, 80335 München', 'München', 48.1397, 11.5655, 1000, 1600, pg_temp.hours(array['13:00','23:30'], array['11:00','00:30']), 150, 'indoor', null, 1, 20),
  ('demo', 'muc-stueberl-9', 'demo', 'Stüberl 9', 'bar', 'Kleine Bar mit Tischkicker und wechselnden Fassbieren.', 'Demowinkel 9, 80469 München', 'München', 48.1312, 11.5702, 500, 1100, pg_temp.hours(array['18:00','01:00'], array['18:00','02:00'], array['sun']), 120, 'indoor', 18, 2, 10),
  -- Köln
  ('demo', 'cgn-veedel-kueche', 'demo', 'Veedel Küche', 'restaurant', 'Tapas zum Teilen – praktisch, wenn sich niemand entscheiden kann.', 'Beispielwall 22, 50672 Köln', 'Köln', 50.9412, 6.9401, 1300, 2500, pg_temp.hours(array['17:30','23:00'], array['17:00','00:00'], array['mon']), 105, 'indoor', null, 2, 14),
  ('demo', 'cgn-domstadt-bowling', 'demo', 'Domstadt Bowling', 'bowling', '20 Bahnen, Billard und Dart im Obergeschoss.', 'Musterstraße 300, 50823 Köln', 'Köln', 50.9523, 6.9218, 1100, 1900, pg_temp.hours(array['15:00','23:00'], array['12:00','01:00']), 120, 'indoor', null, 2, 16),
  ('demo', 'cgn-kartbahn-rheinpark', 'demo', 'Kartbahn Rheinpark', 'karting', 'Outdoor-Strecke mit 800 Metern Länge. Bei Regen geschlossen.', 'Demoufer 50, 50679 Köln', 'Köln', 50.9471, 6.9772, 1800, 2800, pg_temp.hours(array['13:00','20:00'], array['10:00','21:00']), 60, 'outdoor', 14, 2, 10),
  ('demo', 'cgn-kulturbunker-buehne', 'demo', 'Kulturbunker Bühne', 'concert', 'Konzerte, Poetry Slams und Comedy in einem ehemaligen Bunker.', 'Beispielberg 6, 51063 Köln', 'Köln', 50.9668, 7.0034, null, null, null, 150, 'indoor', 16, 1, 20),
  ('demo', 'cgn-cafe-fensterplatz', 'demo', 'Café Fensterplatz', 'cafe', 'Waffeln, Spiele-Regal und große Fensterfront.', 'Mustergasse 11, 50667 Köln', 'Köln', 50.9383, 6.9587, 400, 1100, pg_temp.hours(array['09:00','19:00'], array['10:00','20:00']), 75, 'indoor', null, 1, 8),
  ('demo', 'cgn-rheinufer-bootsverleih', 'demo', 'Rheinufer Bootsverleih', 'outdoor', 'Tretboote und Kajaks, Abgabe spätestens bei Sonnenuntergang.', 'Demopromenade 4, 50668 Köln', 'Köln', 50.9499, 6.9661, 1000, 1600, pg_temp.hours(array['11:00','19:00'], array['10:00','20:00']), 90, 'outdoor', null, 2, 10)
on conflict (provider_id, external_id) do update set
  name = excluded.name, category = excluded.category, description = excluded.description, address = excluded.address,
  city = excluded.city, latitude = excluded.latitude, longitude = excluded.longitude,
  price_min_cents = excluded.price_min_cents, price_max_cents = excluded.price_max_cents,
  opening_hours = excluded.opening_hours, duration_minutes = excluded.duration_minutes, setting = excluded.setting,
  min_age = excluded.min_age, group_min = excluded.group_min, group_max = excluded.group_max, data_source = excluded.data_source;
