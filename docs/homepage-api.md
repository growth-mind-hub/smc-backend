# Homepage vehicle API

Use GET /api/vehicles initially, then GET /api/vehicles?persons=5&luggage=4 when the user submits counts. GET /api/vehicles/recommend?persons=5&luggage=4 returns the same structure but requires both counts. All URLs also work under /api/v1.

The response contains success, requirements and data. Vehicle lists are returned only in data. Each vehicle keeps its names, capacities, images, types, prices and catalog IDs, plus a single boolean recommendation field. There are no recommended/alternatives arrays, recommendation summary objects, suitability flags or reason fields.

GET /api/vehicles returns active and inactive vehicles, including their status and isActive fields. Inactive vehicles always have recommendation: false. GET /api/vehicles/recommend returns active vehicles only. Without counts, or if no vehicle fits, every flag is false. Candidates require known passenger capacity and at least one currently eligible price; requests with bags require a known sufficient luggage capacity. Database recommendationPriority is ranked first, followed by unused capacity, passenger capacity, luggage capacity and vehicle ID.

Apply migration 029 before deploying the new recommendation code. It sets the operator's fleet preferences and capacities:

| Fleet | Passenger limit without bags | Passenger limit with bags | Bag limit | Preference |
| --- | --- | --- | --- | --- |
| E/S Class | 3 | 3 | 3 | First |
| Mercedes V-Class (New) | 7 | 7 | 7 | Second |
| 13-seater minibus / VIP Executive | 13 | 9 | 9 | Third |
| 19/23-seater coaches | 19/23 | Not eligible | 0 | Fourth |
| 40-seater coach | 40 | 30 | 40 | Fifth |

Other vehicles retain their database capacities and default priority 100 as fallback candidates. Inactive or unpriced preferred vehicles cannot be selected. These are recommendation rules, not new booking/quote capacity validation.

For wheelchair transport, send `wheelchair=true` alongside persons and luggage. Only vehicles with wheelchairCapacity > 0 are eligible; standard requests exclude wheelchair vehicles. The 7-seater wheelchair vehicle carries up to 3 accompanying passengers plus one wheelchair user; the 9-seater carries up to 5 accompanying passengers plus one wheelchair user. On wheelchair requests persons counts accompanying passengers, excluding the wheelchair user, and may be zero. This request flag supports one wheelchair user. Wheelchair bag limits are unconfirmed (null), so requests with luggage cannot recommend these vehicles until capacity is configured. The API does not infer wheelchair transport from passenger count.

Example: `/api/v1/vehicles/recommend?persons=3&luggage=0&wheelchair=true`. Existing callers that omit wheelchair continue to request standard transport. Response cards include recommendationPriority, passengerCapacityWithLuggage and wheelchairCapacity.

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
