const fields = 'id, min_distance_km, max_distance_km, min_inclusive, max_inclusive, surcharge, currency, is_contact_support, status, created_at, updated_at';
const mapRule = row => ({ ...row, min_distance_km: Number(row.min_distance_km),
  max_distance_km: row.max_distance_km === null ? null : Number(row.max_distance_km), surcharge: Number(row.surcharge) });

export function distanceRuleRepository(pool) {
  return {
    listDistanceRules: async () => (await pool.query(`SELECT ${fields} FROM distance_pricing_rules ORDER BY min_distance_km, id`)).rows.map(mapRule),
    createDistanceRule: async body => mapRule((await pool.query(`INSERT INTO distance_pricing_rules
      (min_distance_km, max_distance_km, min_inclusive, max_inclusive, surcharge, currency, is_contact_support, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${fields}`,
    [body.min_distance_km, body.max_distance_km ?? null, body.min_inclusive ?? true, body.max_inclusive ?? false,
      body.surcharge ?? 0, body.currency ?? 'SGD', body.is_contact_support ?? false, body.status ?? 'ACTIVE'])).rows[0]),
    updateDistanceRule: async (id, body) => {
      const { rows } = await pool.query(`UPDATE distance_pricing_rules SET
        min_distance_km = COALESCE($2, min_distance_km),
        max_distance_km = CASE WHEN $3 THEN $4 ELSE max_distance_km END,
        min_inclusive = COALESCE($5, min_inclusive), max_inclusive = COALESCE($6, max_inclusive),
        surcharge = COALESCE($7, surcharge), currency = COALESCE($8, currency),
        is_contact_support = COALESCE($9, is_contact_support), status = COALESCE($10, status)
        WHERE id = $1 RETURNING ${fields}`,
      [id, body.min_distance_km ?? null, Object.hasOwn(body, 'max_distance_km'), body.max_distance_km ?? null,
        body.min_inclusive ?? null, body.max_inclusive ?? null, body.surcharge ?? null, body.currency ?? null,
        body.is_contact_support ?? null, body.status ?? null]);
      return rows.length ? mapRule(rows[0]) : null;
    },
  };
}
