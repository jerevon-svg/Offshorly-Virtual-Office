"""Global Team Map V1 — the privacy boundary between Atlas's geocoded roster and the browser.

Atlas's ``GET /api/v1/office/map`` carries each employee's free-text home address and a geocode
of it (house-level precise when it came from Nominatim). Nothing in this package lets either
reach a client: ``atlas_map.py`` reads an allowlist of fields (never ``home_address``), and
``coarse_geo.py`` snaps every coordinate to a public city centroid or a 1-degree grid cell
before ``routers/team_map.py`` serialises it. tests/test_team_map.py pins both walls.
"""
