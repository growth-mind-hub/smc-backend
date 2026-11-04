# Vehicle images

Both endpoints require the existing admin bearer token and return `{ "vehicle": ... }`.

| Method | Endpoint | Request |
| --- | --- | --- |
| POST | `/api/v1/vehicles/:id/image` | `multipart/form-data`, one file in field `image` |
| DELETE | `/api/v1/vehicles/:id/image` | No body required |

JPEG, PNG, GIF and WebP files are accepted based on their file signatures. The maximum file size is 5 MiB (5,242,880 bytes); larger uploads return HTTP 413. Missing or invalid files return HTTP 400. Unknown vehicles return HTTP 404. The `/api/vehicles/:id/image` aliases also work.

Files are saved with generated filenames in `/var/lib/maxicab/uploads/vehicles/`. Override the directory with `VEHICLE_UPLOAD_DIR` for local development. PostgreSQL `vehicles.image_url` stores `/uploads/vehicles/<filename>`, which Express serves publicly. Frontends should prepend the API origin to this path. Replacing an image removes the previous managed upload. DELETE removes the managed file and sets `image_url` to NULL; existing external image URLs are cleared without deleting any external files.

```sh
curl -X POST https://YOUR_API_HOST/api/v1/vehicles/3/image \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -F "image=@vehicle.jpg"

curl -X DELETE https://YOUR_API_HOST/api/v1/vehicles/3/image \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

On the Hostinger server, create the directory with ownership assigned to the Node service user:

```sh
sudo install -d -m 0750 -o NODE_SERVICE_USER -g NODE_SERVICE_GROUP /var/lib/maxicab/uploads/vehicles
```

Set `VEHICLE_UPLOAD_DIR=/var/lib/maxicab/uploads/vehicles` in the server environment. Keep the directory persistent across releases. If Nginx proxies the API, allow multipart overhead with `client_max_body_size 6m;` and proxy `/uploads/vehicles/` to Node as well. Restart the Node service after deploying these changes. No database migration is needed because `vehicles.image_url` already exists.
