const mapAddOn = row => ({ ...row, price: Number(row.price) });

export function addOnRepository(pool) {
  return {
    deleteAddOn: async id => (await pool.query('DELETE FROM add_ons WHERE id = $1 RETURNING id', [id])).rows.length > 0,
    listAddOns: async () => (await pool.query("SELECT * FROM add_ons WHERE status = 'ACTIVE' ORDER BY id")).rows.map(mapAddOn),
    createAddOn: async body => mapAddOn((await pool.query(`INSERT INTO add_ons
      (code, name, description, pricing_type, price, currency, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [body.code, body.name.trim(), body.description ?? '', body.pricing_type, body.price, body.currency ?? 'SGD', body.status ?? 'ACTIVE'])).rows[0]),
    updateAddOn: async (id, body) => {
      const { rows } = await pool.query(`UPDATE add_ons SET name = COALESCE($2, name),
        description = COALESCE($3, description), pricing_type = COALESCE($4, pricing_type),
        price = COALESCE($5, price), currency = COALESCE($6, currency), status = COALESCE($7, status)
        WHERE id = $1 RETURNING *`,
      [id, body.name?.trim() ?? null, body.description ?? null, body.pricing_type ?? null, body.price ?? null, body.currency ?? null, body.status ?? null]);
      return rows.length ? mapAddOn(rows[0]) : null;
    },
    // One statement gives the quote a consistent snapshot of all selected prices.
    getQuoteCatalog: async input => (await pool.query(`SELECT v.name AS vehicle_name,
      s.service_name, s.pricing_unit AS unit, p.id AS catalog_id, p.price, p.currency,
      p.is_from, p.minimum_hours,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'min_distance_km', r.min_distance_km,
        'max_distance_km', r.max_distance_km, 'min_inclusive', r.min_inclusive, 'max_inclusive', r.max_inclusive,
        'surcharge', r.surcharge, 'currency', r.currency, 'is_contact_support', r.is_contact_support))
        FROM distance_pricing_rules r WHERE r.status = 'ACTIVE'), '[]'::jsonb) AS distance_rules,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name,
        'pricing_type', a.pricing_type, 'price', a.price, 'currency', a.currency))
        FROM add_ons a WHERE a.status = 'ACTIVE' AND a.id = ANY($3::integer[])), '[]'::jsonb) AS add_ons
      FROM vehicle_service_prices p
      JOIN vehicles v ON v.id = p.vehicle_id AND v.status = 'active'
      JOIN services s ON s.id = p.service_id AND s.status = 'active'
      WHERE p.vehicle_id = $1 AND p.service_id = $2 AND p.status = 'active'
        AND p.valid_from <= CURRENT_TIMESTAMP AND (p.valid_to IS NULL OR p.valid_to > CURRENT_TIMESTAMP)`,
    [input.vehicle_id, input.service_id, input.add_ons.map(item => item.add_on_id)])).rows[0] ?? null,
  };
}
