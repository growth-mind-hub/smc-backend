-- Prefer V-Class (priority 20); Alphard is a fallback before minibuses (30).
UPDATE vehicles SET passenger_capacity = 6, luggage_capacity = 4,
  passenger_capacity_with_luggage = 4, wheelchair_capacity = 0, recommendation_priority = 25
WHERE name = 'Toyota Alphard / Vellfire';
