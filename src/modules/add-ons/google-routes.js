import { Client } from '@googlemaps/google-maps-services-js';

const failure = (code, message) => Object.assign(new Error(message), { code });
const googleFailure = status => failure('DISTANCE_UNAVAILABLE', status === 'REQUEST_DENIED'
  ? 'Google denied the distance request. Check the API key, Distance Matrix API access and billing.'
  : 'Driving distance could not be retrieved. Please try again.');

export function googleDistanceProvider({ apiKey = process.env.GOOGLE_MAPS_API_KEY, client = new Client({}) } = {}) {
  return async (pickup, drop) => {
    if (!apiKey?.trim()) { throw failure('DISTANCE_UNAVAILABLE', 'Routing service is not configured.'); }
    let response;
    try {
      response = await client.distancematrix({
        params: {
          origins: [pickup.address.trim()], destinations: [drop.address.trim()],
          mode: 'driving', units: 'metric', region: 'sg', key: apiKey.trim(),
        },
        timeout: 5000,
      });
    } catch (err) {
      // Never expose Axios errors: their request URL can contain the API key.
      throw googleFailure(err.response?.data?.status);
    }
    const data = response?.data;
    if (data?.status !== 'OK') { throw googleFailure(data?.status); }
    const element = data.rows?.[0]?.elements?.[0];
    if (['ZERO_RESULTS', 'NOT_FOUND'].includes(element?.status)) { throw failure('ROUTE_NOT_FOUND', 'No driving route found for these addresses.'); }
    if (element?.status !== 'OK') { throw googleFailure(element?.status); }
    const meters = element.distance?.value;
    if (!Number.isSafeInteger(meters) || meters < 0) { throw failure('DISTANCE_UNAVAILABLE', 'Routing service returned an invalid distance.'); }
    return meters;
  };
}
