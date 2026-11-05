// Where Windows thinks this PC is, for the weather's city. It needs Location turned on, with
// "Let desktop apps access your location", in Windows Settings › Privacy & security; when that
// is off this answers { denied } and VyseBar falls back to a city from the IP address.
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Windows.Devices.Geolocation;

namespace VyseHost
{
    public static class Location
    {
        public static async Task<object> Get()
        {
            try
            {
                GeolocationAccessStatus access = await Geolocator.RequestAccessAsync();
                if (access != GeolocationAccessStatus.Allowed)
                    return new Dictionary<string, object> { { "denied", access.ToString() } };
                // city-level is plenty for weather, and lets Windows answer from Wi-Fi without GPS
                Geolocator g = new Geolocator { DesiredAccuracyInMeters = 3000 };
                Task<Geoposition> fix = g.GetGeopositionAsync(TimeSpan.FromMinutes(30), TimeSpan.FromSeconds(10)).AsTask();
                if (await Task.WhenAny(fix, Task.Delay(12000)) != fix) return null;
                Geocoordinate c = fix.Result.Coordinate;
                BasicGeoposition p = c.Point.Position;
                return new Dictionary<string, object> { { "lat", p.Latitude }, { "lon", p.Longitude }, { "accuracy", c.Accuracy } };
            }
            catch (Exception e)
            {
                return new Dictionary<string, object> { { "error", e.Message } };
            }
        }
    }
}
