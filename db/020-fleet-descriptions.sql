-- Fill missing descriptions without overwriting text entered by admins.
WITH descriptions(name, description) AS (VALUES
  ('Mercedes E Class', 'The Mercedes E Class is a sedan option for individual travellers and small groups. Choose it for airport transfers or journeys around Singapore.'),
  ('Mercedes S Class', 'The Mercedes S Class is a luxury sedan option for private travel. Choose it for business journeys, airport transfers or special occasions.'),
  ('Toyota Alphard / Vellfire', 'The Toyota Alphard / Vellfire is an MPV option for families and small groups. Travel together for airport transfers or journeys around Singapore.'),
  ('Mercedes Vito/Viano', 'The Mercedes Vito/Viano is a maxi cab option for families and groups. Keep your group together for airport transfers or travel around Singapore.'),
  ('Mercedes V-Class (New)', 'The Mercedes V-Class is an MPV option for family and group travel. Choose it for airport transfers, business trips or journeys around Singapore.'),
  ('Toyota Hiace 13 seater Minibus', 'The Toyota Hiace is a minibus option for larger groups travelling together. Choose it for airport transfers, group outings or transport around Singapore.'),
  ('VIP / Executive Minibus', 'The VIP / Executive Minibus is an option for business groups and private outings. Keep your group together for airport transfers or journeys around Singapore.'),
  ('Wheelchair-Accessible Maxi Cab', 'The Wheelchair-Accessible Maxi Cab is an option for passengers travelling with a wheelchair. Confirm your wheelchair dimensions and group requirements before booking.'),
  ('7 Seater Maxi Cab Wheelchair', 'The 7 Seater Maxi Cab Wheelchair is an accessible transport option for passengers and their companions. Confirm your wheelchair dimensions and seating requirements before booking.'),
  ('9 Seater Maxi Cab Wheelchair', 'The 9 Seater Maxi Cab Wheelchair is an accessible transport option for group travel. Confirm your wheelchair dimensions and seating requirements before booking.'),
  ('9 Seater Minibus', 'The 9 Seater Minibus is an option for families and groups travelling together. Choose it for airport transfers, group outings or journeys around Singapore.'),
  ('23 Seater Coaches', 'The 23 Seater Coaches are an option for larger groups travelling together. Choose a coach for group transfers, events or organised outings.'),
  ('40 Seater Coaches', 'The 40 Seater Coaches are an option for large group transport. Keep your group together for event transfers, organised outings or travel around Singapore.')
)
UPDATE vehicles v SET description = d.description
FROM descriptions d
WHERE v.name = d.name AND (v.description IS NULL OR btrim(v.description) = '');

-- Cover custom fleet entries whose descriptions are also missing.
UPDATE vehicles SET description =
  name || ' is a fleet option for travel around Singapore. Check its passenger and luggage capacities to choose a vehicle for your journey.'
WHERE description IS NULL OR btrim(description) = '';
