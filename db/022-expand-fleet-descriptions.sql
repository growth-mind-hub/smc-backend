-- Expand the original short descriptions; preserve subsequent admin edits.
WITH descriptions(name, old_description, description) AS (VALUES
  ('7 Seater Maxi Cab Wheelchair', 'Wheelchair accessible; airport pickup from Changi',
   'The 7 Seater Maxi Cab Wheelchair provides accessible transport for passengers and their companions. Choose it for Changi Airport transfers or journeys around Singapore, and confirm wheelchair dimensions and seating requirements before booking.'),
  ('9 Seater Maxi Cab Wheelchair', 'Wheelchair accessible',
   'The 9 Seater Maxi Cab Wheelchair is an accessible option for families and groups travelling with a wheelchair user. Confirm wheelchair dimensions and seating requirements when arranging airport transfers or journeys around Singapore.'),
  ('Mercedes Vito/Viano', '7 Seater Maxicab',
   'The Mercedes Vito/Viano is a seven-seater maxi cab for families and groups travelling together. Choose it for airport transfers, group outings or journeys around Singapore.'),
  ('Mercedes V-Class (New)', '7 Seater Maxicab',
   'The Mercedes V-Class is a seven-seater MPV for family, business and group travel. Choose it for airport transfers, private outings or journeys around Singapore.'),
  ('VIP / Executive Minibus', '13 passengers, or 9 passengers with 8 bags',
   'The VIP / Executive Minibus is an option for business groups and private outings with seating for up to 13 passengers. Check the luggage capacity and seating requirements when arranging airport transfers or group journeys around Singapore.'),
  ('Toyota Alphard / Vellfire', 'Executive MPV for 6 passengers',
   'The Toyota Alphard / Vellfire is a six-seater executive MPV for families and small groups. Travel together for airport transfers, business trips or private journeys around Singapore.')
)
UPDATE vehicles v SET description = d.description
FROM descriptions d
WHERE v.name = d.name
  AND (v.description IS NULL OR btrim(v.description) IN ('', d.old_description))
RETURNING v.id, v.name, v.description;
