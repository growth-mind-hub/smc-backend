# Homepage vehicle API

Use GET /api/vehicles initially, then GET /api/vehicles?persons=5&luggage=4 when the user submits counts. GET /api/vehicles/recommend?persons=5&luggage=4 returns the same structure but requires both counts. All URLs also work under /api/v1.

The response contains success, requirements and data. Vehicle lists are returned only in data. Each vehicle keeps its names, capacities, images, types, prices and catalog IDs, plus a single boolean recommendation field. There are no recommended/alternatives arrays, recommendation summary objects, suitability flags or reason fields.

GET /api/vehicles returns active and inactive vehicles, including their status and isActive fields. Inactive vehicles always have recommendation: false. GET /api/vehicles/recommend continues to return active vehicles only. Without counts, or if no vehicle fits, every flag is false. The ranking uses total unused passenger and luggage capacity, with ties broken by passenger capacity, luggage capacity and vehicle ID. Candidates require known capacities and at least one currently eligible price.

Persons must be 1?100 and luggage 0?100. Incomplete, invalid or unknown parameters return 400. React renders data and shows a badge where vehicle.recommendation is true; customers may still choose another vehicle. The boolean means best fit, not whether other vehicles are suitable. Send the chosen service price's catalogId with future booking details.

Capacities come from PostgreSQL and can be edited through the admin vehicle PATCH endpoint. Initial luggage configuration comes from the supplied examples; confirm actual seat layouts and bag sizes. Active status is catalog visibility, not date-specific booking availability.

Example (abbreviated vehicle fields):

~~~json
{
  "success": true,
  "requirements": { "persons": 5, "luggage": 4 },
  "data": [
    { "id": 1, "name": "Mercedes E Class", "recommendation": false },
    { "id": 3, "name": "Toyota Alphard / Vellfire", "recommendation": true }
  ]
}
~~~

The actual data array includes full vehicle/price fields.
