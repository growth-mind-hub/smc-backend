# Vehicle list with minimum prices

Public endpoint: `GET /api/v1/vehicles/minimum-prices` (also `/api/vehicles/minimum-prices`). No authorization is required.

```bash
curl "http://localhost:3000/api/v1/vehicles/minimum-prices"
```

Example vehicle in the response:

```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "name": "Toyota Alphard / Vellfire",
      "description": "Executive MPV for 6 passengers",
      "imageUrl": null,
      "passengerCapacity": 6,
      "luggageCapacity": 6,
      "minimumPrice": {
        "currency": "SGD",
        "service": "hourly",
        "serviceName": "Hourly Booking",
        "catalogId": 9,
        "isFrom": false,
        "amount": 60,
        "amountMinor": 6000,
        "unit": "hour",
        "minimumHours": 3,
        "hours": null
      }
    }
  ]
}
```

The example catalog ID and service name are illustrative; use the returned values. Only active vehicles and currently valid active service prices are used. The minimum compares configured rates and 3-hour/8-hour package amounts. `unit: "hour"` means the amount is per hour, not the total payable amount; show “SGD 60/hour · minimum 3 hours”. `unit: "trip"` means per trip; `unit: "package"` means the complete package amount for the returned `hours`. Respect `isFrom` when displaying a starting price. Add-ons and distance charges are not included.

`minimumPrice` is null when no prices are available or a vehicle has prices in multiple currencies, which cannot be compared without conversion. Uploaded image paths are relative to the API origin. This endpoint reads the current PostgreSQL catalog and requires no schema changes.
