from __future__ import annotations

import math
from dataclasses import dataclass

# Coarse-location projection for the Global Team Map.
#
# Every coordinate that leaves this backend has passed through snap_coarse(): it is either the
# published centroid of a city in _CITIES (a public landmark, not a person's address) or the
# centre of a 1-degree grid cell (~111 km). Two decimals of output precision (~1 km) is
# deliberately coarser than any input, and the raw input coordinate never appears in the result.
#
# Time zones are derived from the SNAPPED place (city zone, else a country default, else a
# longitude-based Etc/GMT zone) — never from anything more precise than what the browser sees.

CITY_SNAP_RADIUS_KM = 75.0
GRID_DEGREES = 1.0
OUTPUT_DECIMALS = 2

PH = "PH"


@dataclass(frozen=True)
class City:
    label: str
    country_code: str
    latitude: float
    longitude: float
    timezone: str


@dataclass(frozen=True)
class CoarsePlace:
    latitude: float
    longitude: float
    label: str
    country_code: str | None
    timezone: str
    kind: str  # "city" | "region"


# (label, country, lat, lng, tz). Philippine coverage mirrors the workforce; the rest is a
# spread of hubs so an "Elsewhere" employee snaps to a recognisable city rather than a grid cell.
_CITIES: tuple[City, ...] = tuple(
    City(*row)
    for row in (
        # --- Philippines: Metro Manila
        ("Manila", PH, 14.5995, 120.9842, "Asia/Manila"),
        ("Quezon City", PH, 14.6760, 121.0437, "Asia/Manila"),
        ("Makati", PH, 14.5547, 121.0244, "Asia/Manila"),
        ("Pasig", PH, 14.5764, 121.0851, "Asia/Manila"),
        ("Taguig", PH, 14.5176, 121.0509, "Asia/Manila"),
        ("Mandaluyong", PH, 14.5794, 121.0359, "Asia/Manila"),
        ("Parañaque", PH, 14.4793, 121.0198, "Asia/Manila"),
        ("Las Piñas", PH, 14.4445, 120.9939, "Asia/Manila"),
        ("Muntinlupa", PH, 14.4081, 121.0415, "Asia/Manila"),
        ("Marikina", PH, 14.6507, 121.1029, "Asia/Manila"),
        ("Caloocan", PH, 14.6488, 120.9830, "Asia/Manila"),
        ("Valenzuela", PH, 14.7011, 120.9830, "Asia/Manila"),
        ("Pasay", PH, 14.5378, 121.0014, "Asia/Manila"),
        ("San Juan", PH, 14.6019, 121.0355, "Asia/Manila"),
        # --- Philippines: Luzon
        ("Antipolo", PH, 14.5862, 121.1760, "Asia/Manila"),
        ("Bacoor", PH, 14.4624, 120.9645, "Asia/Manila"),
        ("Dasmariñas", PH, 14.3294, 120.9367, "Asia/Manila"),
        ("Imus", PH, 14.4297, 120.9367, "Asia/Manila"),
        ("Santa Rosa", PH, 14.3122, 121.1114, "Asia/Manila"),
        ("Calamba", PH, 14.2117, 121.1653, "Asia/Manila"),
        ("San Pablo", PH, 14.0683, 121.3256, "Asia/Manila"),
        ("Lipa", PH, 13.9411, 121.1622, "Asia/Manila"),
        ("Batangas City", PH, 13.7565, 121.0583, "Asia/Manila"),
        ("Lucena", PH, 13.9373, 121.6170, "Asia/Manila"),
        ("Malolos", PH, 14.8433, 120.8114, "Asia/Manila"),
        ("San Fernando", PH, 15.0286, 120.6898, "Asia/Manila"),
        ("Angeles", PH, 15.1450, 120.5887, "Asia/Manila"),
        ("Tarlac City", PH, 15.4802, 120.5979, "Asia/Manila"),
        ("Olongapo", PH, 14.8292, 120.2828, "Asia/Manila"),
        ("Cabanatuan", PH, 15.4865, 120.9734, "Asia/Manila"),
        ("Baguio", PH, 16.4023, 120.5960, "Asia/Manila"),
        ("Dagupan", PH, 16.0433, 120.3333, "Asia/Manila"),
        ("Laoag", PH, 18.1978, 120.5936, "Asia/Manila"),
        ("Tuguegarao", PH, 17.6132, 121.7270, "Asia/Manila"),
        ("Naga", PH, 13.6218, 123.1948, "Asia/Manila"),
        ("Legazpi", PH, 13.1391, 123.7438, "Asia/Manila"),
        ("Puerto Princesa", PH, 9.7392, 118.7353, "Asia/Manila"),
        # --- Philippines: Visayas
        ("Cebu City", PH, 10.3157, 123.8854, "Asia/Manila"),
        ("Lapu-Lapu", PH, 10.3103, 123.9494, "Asia/Manila"),
        ("Iloilo City", PH, 10.7202, 122.5621, "Asia/Manila"),
        ("Bacolod", PH, 10.6407, 122.9689, "Asia/Manila"),
        ("Tacloban", PH, 11.2543, 125.0000, "Asia/Manila"),
        ("Dumaguete", PH, 9.3068, 123.3054, "Asia/Manila"),
        ("Tagbilaran", PH, 9.6475, 123.8556, "Asia/Manila"),
        ("Kalibo", PH, 11.7086, 122.3648, "Asia/Manila"),
        ("Roxas City", PH, 11.5853, 122.7511, "Asia/Manila"),
        # --- Philippines: Mindanao
        ("Davao City", PH, 7.1907, 125.4553, "Asia/Manila"),
        ("Cagayan de Oro", PH, 8.4542, 124.6319, "Asia/Manila"),
        ("Zamboanga City", PH, 6.9214, 122.0790, "Asia/Manila"),
        ("General Santos", PH, 6.1164, 125.1716, "Asia/Manila"),
        ("Iligan", PH, 8.2280, 124.2452, "Asia/Manila"),
        ("Butuan", PH, 8.9475, 125.5406, "Asia/Manila"),
        # --- Asia-Pacific
        ("Singapore", "SG", 1.3521, 103.8198, "Asia/Singapore"),
        ("Kuala Lumpur", "MY", 3.1390, 101.6869, "Asia/Kuala_Lumpur"),
        ("Bangkok", "TH", 13.7563, 100.5018, "Asia/Bangkok"),
        ("Jakarta", "ID", -6.2088, 106.8456, "Asia/Jakarta"),
        ("Ho Chi Minh City", "VN", 10.8231, 106.6297, "Asia/Ho_Chi_Minh"),
        ("Hanoi", "VN", 21.0278, 105.8342, "Asia/Ho_Chi_Minh"),
        ("Hong Kong", "HK", 22.3193, 114.1694, "Asia/Hong_Kong"),
        ("Taipei", "TW", 25.0330, 121.5654, "Asia/Taipei"),
        ("Tokyo", "JP", 35.6762, 139.6503, "Asia/Tokyo"),
        ("Osaka", "JP", 34.6937, 135.5023, "Asia/Tokyo"),
        ("Seoul", "KR", 37.5665, 126.9780, "Asia/Seoul"),
        ("Sydney", "AU", -33.8688, 151.2093, "Australia/Sydney"),
        ("Melbourne", "AU", -37.8136, 144.9631, "Australia/Melbourne"),
        ("Brisbane", "AU", -27.4698, 153.0251, "Australia/Brisbane"),
        ("Perth", "AU", -31.9505, 115.8605, "Australia/Perth"),
        ("Auckland", "NZ", -36.8509, 174.7645, "Pacific/Auckland"),
        ("Mumbai", "IN", 19.0760, 72.8777, "Asia/Kolkata"),
        ("Bengaluru", "IN", 12.9716, 77.5946, "Asia/Kolkata"),
        ("New Delhi", "IN", 28.6139, 77.2090, "Asia/Kolkata"),
        ("Karachi", "PK", 24.8607, 67.0011, "Asia/Karachi"),
        ("Dhaka", "BD", 23.8103, 90.4125, "Asia/Dhaka"),
        # --- Middle East
        ("Dubai", "AE", 25.2048, 55.2708, "Asia/Dubai"),
        ("Abu Dhabi", "AE", 24.4539, 54.3773, "Asia/Dubai"),
        ("Doha", "QA", 25.2854, 51.5310, "Asia/Qatar"),
        ("Riyadh", "SA", 24.7136, 46.6753, "Asia/Riyadh"),
        # --- Europe
        ("London", "GB", 51.5074, -0.1278, "Europe/London"),
        ("Manchester", "GB", 53.4808, -2.2426, "Europe/London"),
        ("Dublin", "IE", 53.3498, -6.2603, "Europe/Dublin"),
        ("Paris", "FR", 48.8566, 2.3522, "Europe/Paris"),
        ("Berlin", "DE", 52.5200, 13.4050, "Europe/Berlin"),
        ("Madrid", "ES", 40.4168, -3.7038, "Europe/Madrid"),
        ("Lisbon", "PT", 38.7223, -9.1393, "Europe/Lisbon"),
        ("Amsterdam", "NL", 52.3676, 4.9041, "Europe/Amsterdam"),
        ("Rome", "IT", 41.9028, 12.4964, "Europe/Rome"),
        ("Stockholm", "SE", 59.3293, 18.0686, "Europe/Stockholm"),
        ("Warsaw", "PL", 52.2297, 21.0122, "Europe/Warsaw"),
        # --- Americas
        ("Toronto", "CA", 43.6532, -79.3832, "America/Toronto"),
        ("Vancouver", "CA", 49.2827, -123.1207, "America/Vancouver"),
        ("New York", "US", 40.7128, -74.0060, "America/New_York"),
        ("Miami", "US", 25.7617, -80.1918, "America/New_York"),
        ("Chicago", "US", 41.8781, -87.6298, "America/Chicago"),
        ("Dallas", "US", 32.7767, -96.7970, "America/Chicago"),
        ("Denver", "US", 39.7392, -104.9903, "America/Denver"),
        ("Los Angeles", "US", 34.0522, -118.2437, "America/Los_Angeles"),
        ("San Francisco", "US", 37.7749, -122.4194, "America/Los_Angeles"),
        ("Seattle", "US", 47.6062, -122.3321, "America/Los_Angeles"),
        ("Honolulu", "US", 21.3069, -157.8583, "Pacific/Honolulu"),
        ("Mexico City", "MX", 19.4326, -99.1332, "America/Mexico_City"),
        ("São Paulo", "BR", -23.5505, -46.6333, "America/Sao_Paulo"),
        ("Buenos Aires", "AR", -34.6037, -58.3816, "America/Argentina/Buenos_Aires"),
        # --- Africa
        ("Johannesburg", "ZA", -26.2041, 28.0473, "Africa/Johannesburg"),
        ("Lagos", "NG", 6.5244, 3.3792, "Africa/Lagos"),
        ("Nairobi", "KE", -1.2921, 36.8219, "Africa/Nairobi"),
        ("Cairo", "EG", 30.0444, 31.2357, "Africa/Cairo"),
    )
)

# Country default zone for grid-cell fallbacks. Multi-zone countries are resolved by longitude
# in _country_timezone below; single-zone countries are listed here.
_COUNTRY_TZ: dict[str, str] = {
    PH: "Asia/Manila",
    "SG": "Asia/Singapore",
    "MY": "Asia/Kuala_Lumpur",
    "TH": "Asia/Bangkok",
    "VN": "Asia/Ho_Chi_Minh",
    "HK": "Asia/Hong_Kong",
    "TW": "Asia/Taipei",
    "JP": "Asia/Tokyo",
    "KR": "Asia/Seoul",
    "NZ": "Pacific/Auckland",
    "IN": "Asia/Kolkata",
    "PK": "Asia/Karachi",
    "BD": "Asia/Dhaka",
    "AE": "Asia/Dubai",
    "QA": "Asia/Qatar",
    "SA": "Asia/Riyadh",
    "GB": "Europe/London",
    "IE": "Europe/Dublin",
    "FR": "Europe/Paris",
    "DE": "Europe/Berlin",
    "ES": "Europe/Madrid",
    "PT": "Europe/Lisbon",
    "NL": "Europe/Amsterdam",
    "IT": "Europe/Rome",
    "SE": "Europe/Stockholm",
    "PL": "Europe/Warsaw",
    "ZA": "Africa/Johannesburg",
    "NG": "Africa/Lagos",
    "KE": "Africa/Nairobi",
    "EG": "Africa/Cairo",
    "AR": "America/Argentina/Buenos_Aires",
    "CN": "Asia/Shanghai",
}

_COUNTRY_NAMES: dict[str, str] = {
    PH: "Philippines",
    "SG": "Singapore",
    "MY": "Malaysia",
    "TH": "Thailand",
    "ID": "Indonesia",
    "VN": "Vietnam",
    "HK": "Hong Kong",
    "TW": "Taiwan",
    "JP": "Japan",
    "KR": "South Korea",
    "AU": "Australia",
    "NZ": "New Zealand",
    "IN": "India",
    "PK": "Pakistan",
    "BD": "Bangladesh",
    "AE": "United Arab Emirates",
    "QA": "Qatar",
    "SA": "Saudi Arabia",
    "GB": "United Kingdom",
    "IE": "Ireland",
    "FR": "France",
    "DE": "Germany",
    "ES": "Spain",
    "PT": "Portugal",
    "NL": "Netherlands",
    "IT": "Italy",
    "SE": "Sweden",
    "PL": "Poland",
    "CA": "Canada",
    "US": "United States",
    "MX": "Mexico",
    "BR": "Brazil",
    "AR": "Argentina",
    "ZA": "South Africa",
    "NG": "Nigeria",
    "KE": "Kenya",
    "EG": "Egypt",
    "CN": "China",
    "RU": "Russia",
}


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_city(lat: float, lng: float, *, radius_km: float = CITY_SNAP_RADIUS_KM) -> City | None:
    best: City | None = None
    best_km = radius_km
    for city in _CITIES:
        km = _haversine_km(lat, lng, city.latitude, city.longitude)
        if km <= best_km:
            best, best_km = city, km
    return best


def _grid_centre(value: float) -> float:
    return math.floor(value / GRID_DEGREES) * GRID_DEGREES + GRID_DEGREES / 2


def _longitude_zone(lng: float) -> str:
    """Last-resort zone from longitude alone. Etc/GMT signs are inverted by convention:
    Etc/GMT-8 is UTC+8."""
    offset = int(round(lng / 15.0))
    offset = max(-12, min(14, offset))
    if offset == 0:
        return "Etc/UTC"
    return f"Etc/GMT{'-' if offset > 0 else '+'}{abs(offset)}"


def _country_timezone(country_code: str | None, lng: float) -> str:
    if country_code == "US":
        if lng < -140:
            return "America/Anchorage"
        if lng < -114:
            return "America/Los_Angeles"
        if lng < -102:
            return "America/Denver"
        if lng < -87:
            return "America/Chicago"
        return "America/New_York"
    if country_code == "CA":
        if lng < -120:
            return "America/Vancouver"
        if lng < -102:
            return "America/Edmonton"
        if lng < -90:
            return "America/Winnipeg"
        if lng < -63:
            return "America/Toronto"
        return "America/Halifax"
    if country_code == "AU":
        if lng < 129:
            return "Australia/Perth"
        if lng < 141:
            return "Australia/Adelaide"
        return "Australia/Sydney"
    if country_code == "BR":
        return "America/Sao_Paulo" if lng > -50 else "America/Manaus"
    if country_code == "MX":
        return "America/Mexico_City" if lng > -105 else "America/Hermosillo"
    if country_code == "ID":
        if lng < 115:
            return "Asia/Jakarta"
        if lng < 128:
            return "Asia/Makassar"
        return "Asia/Jayapura"
    if country_code == "RU":
        return _longitude_zone(lng)
    if country_code and country_code in _COUNTRY_TZ:
        return _COUNTRY_TZ[country_code]
    return _longitude_zone(lng)


def country_name(country_code: str | None) -> str | None:
    return _COUNTRY_NAMES.get(country_code) if country_code else None


def snap_coarse(lat: float, lng: float, country_code: str | None) -> CoarsePlace:
    """Project a raw coordinate onto a public city centroid or a 1-degree grid cell.

    The returned coordinate is never the input: a city match returns that city's published
    centroid; otherwise the centre of the containing grid cell. Both are rounded to
    OUTPUT_DECIMALS. ``country_code`` from Atlas wins when present; a city match supplies it
    when Atlas had none.
    """
    code = country_code.upper() if country_code else None
    city = nearest_city(lat, lng)
    if city is not None and (code is None or code == city.country_code):
        return CoarsePlace(
            latitude=round(city.latitude, OUTPUT_DECIMALS),
            longitude=round(city.longitude, OUTPUT_DECIMALS),
            label=f"{city.label}, {country_name(city.country_code) or city.country_code}",
            country_code=city.country_code,
            timezone=city.timezone,
            kind="city",
        )
    centre_lat = round(_grid_centre(lat), OUTPUT_DECIMALS)
    centre_lng = round(_grid_centre(lng), OUTPUT_DECIMALS)
    label = country_name(code) or (code if code else "Unknown region")
    return CoarsePlace(
        latitude=centre_lat,
        longitude=centre_lng,
        label=label,
        country_code=code,
        timezone=_country_timezone(code, centre_lng),
        kind="region",
    )
